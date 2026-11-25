// Everything a visitor configures lives in their own browser (localStorage).
// Nothing here is ever stored on the Coldkite server.

export type Provider = "gmail" | "resend";

export type Settings = {
  // About you: the AI uses only these facts when it writes.
  name: string;
  profile: string;
  signature: string;
  closingLine: string;
  extraRules: string;

  // AI
  anthropicKey: string;
  model: string;

  // Sending
  provider: Provider;
  gmailUser: string;
  gmailAppPassword: string;
  resendKey: string;
  fromAddress: string;
  testTo: string;
};

export type Resume = { filename: string; base64: string };

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best writing)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest)" },
];

export const EMPTY_SETTINGS: Settings = {
  name: "",
  profile: "",
  signature: "",
  closingLine: "",
  extraRules: "",
  anthropicKey: "",
  model: MODELS[0].id,
  provider: "gmail",
  gmailUser: "",
  gmailAppPassword: "",
  resendKey: "",
  fromAddress: "",
  testTo: "",
};

export const PROFILE_PLACEHOLDER = `Name: Alex Rivera
Title: Backend Engineer (Python, Go)
Experience: 3 years full-time
Based in: Lisbon, Portugal. Open to remote, or relocation with visa sponsorship.
Portfolio: https://alex.dev · GitHub: https://github.com/alex

EXPERIENCE
Backend Engineer, Acme Payments (2022 – now)
- Built the payouts API in FastAPI on Postgres
- Moved batch jobs to a queue-based pipeline on AWS

PROJECTS
- shipq: open-source job queue in Go

SKILLS
Python, FastAPI, Go, Postgres, Redis, AWS, Docker`;

const KEY = "coldkite:settings:v1";
const RESUME_KEY = "coldkite:resume:v1";

export function loadSettings(): Settings {
  try {
    return { ...EMPTY_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveSettings(s: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function loadResume(): Resume | null {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function saveResume(r: Resume | null): boolean {
  try {
    if (r) localStorage.setItem(RESUME_KEY, JSON.stringify(r));
    else localStorage.removeItem(RESUME_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearEverything() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("coldkite:")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function senderOf(s: Settings): string {
  return s.fromAddress.trim() || (s.provider === "gmail" ? s.gmailUser.trim() : "");
}

// What is still missing before each feature works.
export function missingForDraft(s: Settings): string[] {
  const m: string[] = [];
  if (!s.name.trim()) m.push("your name");
  if (!s.profile.trim()) m.push("your profile");
  if (!s.anthropicKey.trim()) m.push("an Anthropic API key");
  return m;
}

export function missingForSend(s: Settings): string[] {
  const m: string[] = [];
  if (s.provider === "gmail") {
    if (!s.gmailUser.trim()) m.push("Gmail address");
    if (!s.gmailAppPassword.trim()) m.push("Gmail app password");
  } else {
    if (!s.resendKey.trim()) m.push("Resend API key");
    if (!s.fromAddress.trim()) m.push("From address");
  }
  return m;
}
