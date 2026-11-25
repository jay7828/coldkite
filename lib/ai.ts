// Runs in the browser. The visitor's Anthropic key goes straight from their
// browser to api.anthropic.com; it never passes through the Coldkite server.
import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "./settings";

export type ImageInput = { format: "png" | "jpeg" | "gif" | "webp"; base64: string };

export type Draft = {
  is_job_post: boolean;
  role: string;
  company: string;
  contact_name: string;
  emails_found: string[];
  to: string;
  apply_note: string;
  location: string;
  requirements: string[];
  matches: string[];
  gaps: string[];
  fit: "strong" | "good" | "stretch" | "poor";
  subject: string;
  body: string;
};

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    is_job_post: { type: "boolean" },
    role: { type: "string" },
    company: { type: "string" },
    contact_name: { type: "string", description: "Hiring contact's full name, or empty" },
    emails_found: { type: "array", items: { type: "string" } },
    to: { type: "string" },
    apply_note: { type: "string", description: "How to apply / where to send, one sentence" },
    location: { type: "string" },
    requirements: { type: "array", items: { type: "string" } },
    matches: { type: "array", items: { type: "string" }, description: 'Up to 4 short tags, 2-5 words each, e.g. "FastAPI backends"' },
    gaps: { type: "array", items: { type: "string" }, description: 'Up to 3 short tags, 2-5 words each, e.g. "No Go experience"' },
    fit: { type: "string", enum: ["strong", "good", "stretch", "poor"] },
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: [
    "is_job_post", "role", "company", "contact_name", "emails_found", "to", "apply_note",
    "location", "requirements", "matches", "gaps", "fit", "subject", "body",
  ],
};

export function buildSystemPrompt(s: Settings, hasResume: boolean): string {
  const name = s.name.trim();
  const signature = s.signature.trim() || `Best,\n${name}`;
  const closing = s.closingLine.trim();
  const extra = s.extraRules.trim();

  return `You help ${name} apply for jobs. You get a job post or hiring message (a screenshot and/or pasted text, often from LinkedIn or X). Read it carefully, then reply with the analysis and the email as JSON.

Analysis
- Pull out the role, company, location/remote terms, the poster or hiring contact's name, and the key requirements.
- emails_found: the addresses this application should go to (the apply/CV address, plus any cc or hiring contact the post says to include). Skip addresses meant for other roles, interns, press or support. Only email addresses literally written in the post. Never guess, construct or "pattern" an address (no firstname@company.com). If none are written, leave it empty, set "to" to "" and say in apply_note how to apply instead (link, DM, form, "comment interested", etc.).
- "to": the best address from emails_found for an application (prefer a named recruiter or the jobs/careers address mentioned for this role).
- matches: concrete overlaps between the requirements and ${name}'s profile. gaps: requirements they don't clearly meet (be honest; e.g. years of experience, a language they haven't used).
- fit: strong / good / stretch / poor.

The email
- From ${name}, first person, to the hiring person. Body before the signature: 110–150 words, hard limit 150. Three short paragraphs plus the close.
- Greeting with the contact's first name if known, otherwise "Hi <Company> team". If emails_found has more than one address, the same mail goes to all of them, so use "Hi <Company> team".
- Para 1 (one or two sentences): the exact role. Only say where they saw it (LinkedIn, X...) if the input makes that clear.
- Para 2: briefly, what they have built or done that matches THIS post (product or project names and the tech, tied to what the post asks for). Keep it high level: no percentages or metrics unless the profile states them, no long lists. At most one personal project, only if it fits. Don't list everything.
- Para 3 (one sentence): location or work arrangement, honestly, only if the post needs it and the profile says something about it.
- Close with a light ask (a short call)${hasResume ? " and say the resume is attached" : ""}.${closing ? ` Then this exact line on its own: "${closing}"` : ""}
- Plain, warm, confident, no buzzwords, no "I hope this email finds you well", no "I am writing to express", no exclamation marks, no em dashes, no bullet points.
- Use only facts in the profile below. Don't invent experience, years, skills, employers or results. Keep every achievement attached to the job or project it belongs to.
- End the body with exactly this signature:
${signature}
- subject: specific and short, like "Backend Engineer (Python) application – ${name}".${extra ? `\n\nExtra instructions from ${name}\n${extra}` : ""}

If the input isn't a job or hiring post, set is_job_post false, still fill what you can, and leave subject/body empty.

${name.toUpperCase()}'S PROFILE
${s.profile.trim()}`;
}

export async function draftFromPost(
  s: Settings,
  hasResume: boolean,
  text: string,
  images: ImageInput[],
): Promise<Draft> {
  const client = new Anthropic({ apiKey: s.anthropicKey.trim(), dangerouslyAllowBrowser: true });

  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: `image/${img.format}`, data: img.base64 },
  }));
  content.push({
    type: "text",
    text: `Today's date: ${new Date().toISOString().slice(0, 10)}.\n\n` +
      (text.trim() ? `Job post text:\n\n${text.trim()}` : "The job post is in the image above."),
  });

  // Server-side fallback re-runs a refused request on another model. Haiku has no fallback.
  const fallback = s.model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const res = await client.beta.messages.create({
    model: s.model,
    max_tokens: 16000,
    system: buildSystemPrompt(s, hasResume),
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    ...fallback,
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  if (res.stop_reason === "max_tokens") throw new Error("The reply was cut off; try again");
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("The model did not return a draft");
  const draft = JSON.parse(block.text) as Draft;

  // Never trust a guessed address: with text-only input, keep only addresses written in the text.
  const lowerText = text.toLowerCase();
  draft.emails_found = (draft.emails_found ?? []).filter(
    (e) => EMAIL_RE.test(e) && (images.length > 0 || lowerText.includes(e.toLowerCase())),
  );
  if (draft.to && !draft.emails_found.includes(draft.to)) draft.to = draft.emails_found[0] ?? "";
  // The same mail goes to every address, so a personal greeting would be wrong for the others.
  if (draft.emails_found.length > 1 && draft.company && draft.body) {
    draft.body = draft.body.replace(/^(Hi|Hello|Dear)\s+[^,\n]+,/, `Hi ${draft.company} team,`);
  }
  return draft;
}

export function friendlyAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Wait a minute and retry.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection.";
  if (e instanceof Anthropic.APIError) return e.message;
  return e instanceof Error ? e.message : "Draft failed";
}
