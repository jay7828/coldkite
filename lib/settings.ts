// Everything a visitor configures lives in their own browser (localStorage).
// Nothing here is ever stored on the Coldkite server.

export type Provider = "gmail" | "resend";
export type AiProvider = "anthropic" | "openai" | "gemini" | "openrouter" | "custom";

export const AI_PROVIDERS: {
  id: AiProvider;
  label: string;
  keyHint: string;
  keyUrl?: string;
  keyPlaceholder: string;
  defaultModel: string;
  suggestions: string[];
}[] = [
  {
    id: "anthropic", label: "Claude (Anthropic)", keyUrl: "https://platform.claude.com/settings/keys",
    keyHint: "platform.claude.com", keyPlaceholder: "sk-ant-...", defaultModel: "claude-opus-5-5",
    suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "platform.openai.com", keyPlaceholder: "sk-...", defaultModel: "gpt-5",
    suggestions: ["gpt-5", "gpt-5-mini"],
  },
  {
    id: "gemini", label: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "aistudio.google.com (has a free tier)", keyPlaceholder: "AIza...", defaultModel: "gemini-2.5-flash",
    suggestions: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    id: "openrouter", label: "OpenRouter (hundreds of models)", keyUrl: "https://openrouter.ai/keys",
    keyHint: "openrouter.ai", keyPlaceholder: "sk-or-...", defaultModel: "anthropic/claude-sonnet-5-5",
    suggestions: ["anthropic/claude-sonnet-5-5", "openai/gpt-5", "google/gemini-2.5-flash", "meta-llama/llama-4-maverick"],
  },
  {
    id: "custom", label: "Other (OpenAI-compatible)",
    keyHint: "your provider. Works with Groq, DeepSeek, Mistral, Together, a local Ollama and others, as long as they allow browser requests (CORS)",
    keyPlaceholder: "API key (leave empty for local Ollama)", defaultModel: "", suggestions: [],
  },
];

export function aiProviderInfo(id: AiProvider) {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export type Settings = {
  // About you: the AI uses only these facts when it writes.
  name: string;
  profile: string;
  signature: string;
  closingLine: string;
  extraRules: string;

  // AI: one key and model per provider, so switching keeps them.
  aiProvider: AiProvider;
  aiKeys: Partial<Record<AiProvider, string>>;
  aiModels: Partial<Record<AiProvider, string>>;
  customBaseUrl: string;

  // Sending
  provider: Provider;
  gmailUser: string;
  gmailAppPassword: string;
  resendKey: string;
  fromAddress: string;
  testTo: string;
};

export type Resume = { filename: string; base64: string };

export const EMPTY_SETTINGS: Settings = {
  name: "",
  profile: "",
  signature: "",
  closingLine: "",
  extraRules: "",
  aiProvider: "anthropic",
  aiKeys: {},
  aiModels: {},
  customBaseUrl: "",
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
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const s: Settings = { ...EMPTY_SETTINGS, ...raw };
    // v0.1 stored a single Anthropic key and model.
    if (raw.anthropicKey && !s.aiKeys.anthropic) s.aiKeys = { ...s.aiKeys, anthropic: raw.anthropicKey };
    if (raw.model && !s.aiModels.anthropic) s.aiModels = { ...s.aiModels, anthropic: raw.model };
    delete (s as Record<string, unknown>).anthropicKey;
    delete (s as Record<string, unknown>).model;
    return s;
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function aiKey(s: Settings): string {
  return (s.aiKeys[s.aiProvider] ?? "").trim();
}

export function aiModel(s: Settings): string {
  return (s.aiModels[s.aiProvider] ?? "").trim() || aiProviderInfo(s.aiProvider).defaultModel;
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
  if (s.aiProvider === "custom") {
    if (!s.customBaseUrl.trim()) m.push("the AI base URL");
  } else if (!aiKey(s)) {
    m.push(`a ${aiProviderInfo(s.aiProvider).label} API key`);
  }
  if (!aiModel(s)) m.push("an AI model name");
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
