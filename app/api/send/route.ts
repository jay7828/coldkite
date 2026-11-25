import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

// Stateless relay. Browsers can't speak SMTP, and Resend blocks browser calls,
// so the visitor's browser sends its own credentials with each request. They
// are used for this one email and then dropped: nothing is stored or logged.

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;
const MAX_ATTACHMENT_B64 = 3_000_000; // ~2.2 MB PDF; Vercel caps requests at 4.5 MB

type Body = {
  provider?: "gmail" | "resend";
  gmailUser?: string;
  gmailAppPassword?: string;
  resendKey?: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  attachment?: { filename?: string; base64?: string } | null;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2328">${paragraphs}</div>`;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const to = b.to?.trim() ?? "";
  const subject = b.subject?.trim() ?? "";
  const text = b.text ?? "";

  if (!EMAIL_RE.test(to)) return bad("Invalid recipient address");
  if (!subject || subject.length > MAX_SUBJECT) return bad("Subject is empty or too long");
  if (!text.trim() || text.length > MAX_BODY) return bad("Body is empty or too long");

  let attachment: { filename: string; content: Buffer } | undefined;
  if (b.attachment?.base64) {
    if (b.attachment.base64.length > MAX_ATTACHMENT_B64) return bad("Resume is too large (max ~2 MB)");
    const filename = (b.attachment.filename || "resume.pdf").replace(/[^\w .()-]/g, "_").slice(0, 120);
    attachment = { filename, content: Buffer.from(b.attachment.base64, "base64") };
  }

  try {
    if (b.provider === "resend") {
      if (!b.resendKey || !b.from) return bad("Resend needs an API key and a From address");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${b.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: b.from,
          to: [to],
          subject,
          text,
          html: textToHtml(text),
          attachments: attachment ? [{ filename: attachment.filename, content: b.attachment!.base64 }] : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return bad(data.message ?? `Resend error ${res.status}`, 502);
      return NextResponse.json({ ok: true, id: data.id });
    }

    if (!b.gmailUser || !b.gmailAppPassword) return bad("Gmail needs your address and an app password");
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: b.gmailUser, pass: b.gmailAppPassword.replace(/\s+/g, "") },
    });
    const info = await transport.sendMail({
      from: b.from || b.gmailUser,
      to,
      subject,
      text,
      html: textToHtml(text),
      attachments: attachment ? [{ ...attachment, contentType: "application/pdf" }] : undefined,
    });
    return NextResponse.json({ ok: true, id: info.messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    // Gmail's auth error is cryptic; translate the common one.
    if (/Invalid login|535/.test(msg)) return bad("Gmail rejected the login. Use an app password, not your normal password.", 502);
    return bad(msg, 502);
  }
}
