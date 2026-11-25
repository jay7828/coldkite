// Runs in the browser. The visitor's Anthropic key goes straight from their
// browser to api.anthropic.com; it never passes through the Coldkite server.
import Anthropic from "@anthropic-ai/sdk";
import { aiKey, aiModel, type Settings } from "./settings";

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

  return `You help ${name} apply for jobs. You get a job post or hiring message (a screenshot and/or pasted text, often from LinkedIn or X). Read it carefully, then reply with the analysis and the email as one JSON object.

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

// For providers without a strict schema option, the shape goes in the prompt.
const JSON_INSTRUCTIONS = `

Reply with ONLY a JSON object (no markdown, no code fence) matching this JSON Schema:
${JSON.stringify(SCHEMA, null, 1)}`;

class AiError extends Error {}

function userText(text: string): string {
  return `Today's date: ${new Date().toISOString().slice(0, 10)}.\n\n` +
    (text.trim() ? `Job post text:\n\n${text.trim()}` : "The job post is in the image above.");
}

// Pull the JSON object out of a reply, even if a model wrapped it in a code fence or prose.
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new AiError("The model did not return a draft. Try again or pick another model.");
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new AiError("The model returned malformed JSON. Try again or pick another model.");
    }
  }
}

// Fill gaps so a loosely-following model can't break the UI.
function normalize(x: unknown): Draft {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((v): v is string => typeof v === "string") : []);
  const fit = str("fit");
  return {
    is_job_post: typeof o.is_job_post === "boolean" ? o.is_job_post : Boolean(str("body")),
    role: str("role"),
    company: str("company"),
    contact_name: str("contact_name"),
    emails_found: arr("emails_found"),
    to: str("to"),
    apply_note: str("apply_note"),
    location: str("location"),
    requirements: arr("requirements"),
    matches: arr("matches"),
    gaps: arr("gaps"),
    fit: (["strong", "good", "stretch", "poor"].includes(fit) ? fit : "good") as Draft["fit"],
    subject: str("subject"),
    body: str("body"),
  };
}

async function readError(res: Response, who: string): Promise<never> {
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string; message?: string };
  const msg = typeof data.error === "string" ? data.error : data.error?.message ?? data.message;
  if (res.status === 401 || res.status === 403) throw new AiError(`${who} rejected the API key${msg ? `: ${msg}` : ""}`);
  if (res.status === 429) throw new AiError(`${who} rate limit or quota hit. Wait a minute or check billing.`);
  if (res.status === 404) throw new AiError(`${who} doesn't know that model${msg ? `: ${msg}` : ""}`);
  throw new AiError(msg ?? `${who} error ${res.status}`);
}

async function viaAnthropic(s: Settings, system: string, text: string, images: ImageInput[]): Promise<unknown> {
  const client = new Anthropic({ apiKey: aiKey(s), dangerouslyAllowBrowser: true });
  const model = aiModel(s);
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: `image/${img.format}`, data: img.base64 },
  }));
  content.push({ type: "text", text: userText(text) });

  // Server-side fallback re-runs a refused request on another model. Only for current Opus/Sonnet/Fable.
  const fallback = /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const res = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    ...fallback,
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (res.stop_reason === "refusal") throw new AiError("The model declined this request");
  if (res.stop_reason === "max_tokens") throw new AiError("The reply was cut off; try again");
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new AiError("The model did not return a draft");
  return parseJson(block.text);
}

// OpenAI, OpenRouter and any OpenAI-compatible endpoint share the Chat Completions shape.
async function viaChatCompletions(
  s: Settings,
  system: string,
  text: string,
  images: ImageInput[],
  opts: { base: string; who: string; strictSchema: boolean; headers?: Record<string, string> },
): Promise<unknown> {
  const key = aiKey(s);
  const content = [
    ...images.map((img) => ({ type: "image_url", image_url: { url: `data:image/${img.format};base64,${img.base64}` } })),
    { type: "text", text: userText(text) },
  ];
  const body: Record<string, unknown> = {
    model: aiModel(s),
    messages: [
      { role: "system", content: opts.strictSchema ? system : system + JSON_INSTRUCTIONS },
      { role: "user", content: images.length ? content : userText(text) },
    ],
  };
  if (opts.strictSchema) {
    body.response_format = { type: "json_schema", json_schema: { name: "draft_email", strict: true, schema: SCHEMA } };
  }
  const res = await fetch(`${opts.base.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...opts.headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res, opts.who);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new AiError(`The model declined: ${choice.message.refusal}`);
  if (choice?.finish_reason === "length") throw new AiError("The reply was cut off; try again");
  return parseJson(choice?.message?.content ?? "");
}

async function viaGemini(s: Settings, system: string, text: string, images: ImageInput[]): Promise<unknown> {
  const model = aiModel(s).replace(/^models\//, "");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": aiKey(s) },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system + JSON_INSTRUCTIONS }] },
      contents: [{
        role: "user",
        parts: [
          ...images.map((img) => ({ inline_data: { mime_type: `image/${img.format}`, data: img.base64 } })),
          { text: userText(text) },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) await readError(res, "Gemini");
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new AiError(`Gemini blocked the request (${data.promptFeedback.blockReason})`);
  const cand = data.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw new AiError("The reply was cut off; try again");
  const out = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  return parseJson(out);
}

export async function draftFromPost(
  s: Settings,
  hasResume: boolean,
  text: string,
  images: ImageInput[],
): Promise<Draft> {
  const system = buildSystemPrompt(s, hasResume);
  let raw: unknown;
  switch (s.aiProvider) {
    case "openai":
      raw = await viaChatCompletions(s, system, text, images, { base: "https://api.openai.com/v1", who: "OpenAI", strictSchema: true });
      break;
    case "openrouter":
      raw = await viaChatCompletions(s, system, text, images, {
        base: "https://openrouter.ai/api/v1", who: "OpenRouter", strictSchema: false,
        headers: { "X-Title": "Coldkite" },
      });
      break;
    case "custom":
      raw = await viaChatCompletions(s, system, text, images, { base: s.customBaseUrl.trim(), who: "The AI provider", strictSchema: false });
      break;
    case "gemini":
      raw = await viaGemini(s, system, text, images);
      break;
    default:
      raw = await viaAnthropic(s, system, text, images);
  }
  const draft = normalize(raw);

  // Never trust a guessed address: with text-only input, keep only addresses written in the text.
  const lowerText = text.toLowerCase();
  draft.emails_found = draft.emails_found.filter(
    (e) => EMAIL_RE.test(e) && (images.length > 0 || lowerText.includes(e.toLowerCase())),
  );
  if (draft.to && !draft.emails_found.includes(draft.to)) draft.to = draft.emails_found[0] ?? "";
  // The same mail goes to every address, so a personal greeting would be wrong for the others.
  if (draft.emails_found.length > 1 && draft.company && draft.body) {
    draft.body = draft.body.replace(/^(Hi|Hello|Dear)\s+[^,\n]+,/, `Hi ${draft.company} team,`);
  }
  return draft;
}

// Lists model ids the visitor's key can use, for the model picker.
export async function listModels(s: Settings): Promise<string[]> {
  const key = aiKey(s);
  switch (s.aiProvider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    }
    case "gemini": {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } });
      if (!res.ok) await readError(res, "Gemini");
      const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      return (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
    }
    default: {
      const base = s.aiProvider === "openai" ? "https://api.openai.com/v1"
        : s.aiProvider === "openrouter" ? "https://openrouter.ai/api/v1"
        : s.customBaseUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
      if (!res.ok) await readError(res, "The provider");
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data ?? []).map((m) => m.id).sort();
    }
  }
}

export function friendlyAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (e instanceof Anthropic.NotFoundError) return "Anthropic doesn't know that model name.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic. Wait a minute and retry.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic. Check your connection.";
  if (e instanceof Anthropic.APIError) return e.message;
  // A blocked cross-origin request surfaces as a bare TypeError from fetch.
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) {
    return "Couldn't reach the AI provider. Check the URL, your connection, and that it allows browser (CORS) requests.";
  }
  return e instanceof Error ? e.message : "Draft failed";
}
