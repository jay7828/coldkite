import { senderOf, type Resume, type Settings } from "./settings";

// Sends one email through the stateless /api/send relay, using this browser's settings.
export async function sendOne(
  s: Settings,
  mail: { to: string; subject: string; text: string },
  resume: Resume | null,
): Promise<void> {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: s.provider,
      gmailUser: s.gmailUser.trim(),
      gmailAppPassword: s.gmailAppPassword,
      resendKey: s.resendKey.trim(),
      from: senderOf(s),
      ...mail,
      attachment: resume,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
}

export const SEND_GAP_MS = 2500;
export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Addresses this browser has mailed before, for duplicate warnings.
const SENT_KEY = "coldkite:sent:v1";
export type SentEntry = { to: string; subject: string; at: string };

export function loadSent(): SentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function recordSent(entry: SentEntry) {
  try {
    const log = [entry, ...loadSent()].slice(0, 1000);
    localStorage.setItem(SENT_KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}
