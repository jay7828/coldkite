"use client";

import { useEffect, useRef, useState } from "react";
import { draftFromPost, friendlyAiError, type Draft } from "@/lib/ai";
import { missingForDraft, missingForSend, type Resume, type Settings } from "@/lib/settings";
import { EMAIL_RE, SEND_GAP_MS, loadSent, recordSent, sendOne, sleep } from "@/lib/send";

type Img = { id: string; format: "jpeg"; base64: string; url: string };
export type Notify = (kind: "ok" | "err" | "info", text: string) => void;

const MAX_EDGE = 2000;
const MAX_IMAGES = 4;

function splitEmails(s: string): string[] {
  const seen = new Set<string>();
  return s
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e && !seen.has(e.toLowerCase()) && seen.add(e.toLowerCase()));
}

function wordCount(body: string, signature: string): number {
  const firstSigLine = signature.trim().split("\n")[0];
  const main = firstSigLine && body.includes(firstSigLine) ? body.slice(0, body.lastIndexOf(firstSigLine)) : body;
  return main.trim() ? main.trim().split(/\s+/).length : 0;
}

// Shrink big screenshots in the browser so requests stay small.
async function toImg(file: File): Promise<Img> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { id: Math.random().toString(36).slice(2), format: "jpeg", base64: url.split(",")[1], url };
}

const Icon = {
  image: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
  ),
  clip: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
  ),
  mail: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>
  ),
  send: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>
  ),
};

export default function JobDraft({
  settings,
  resume,
  notify,
  openSettings,
}: {
  settings: Settings;
  resume: Resume | null;
  notify: Notify;
  openSettings: () => void;
}) {
  const [images, setImages] = useState<Img[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "test" | "send">("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachResume, setAttachResume] = useState(Boolean(resume));
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setAttachResume(Boolean(resume)), [resume]);

  const draftMissing = missingForDraft(settings);
  const sendMissing = missingForSend(settings);

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES - images.length);
    if (!list.length) return;
    try {
      const imgs = await Promise.all(list.map(toImg));
      setImages((cur) => [...cur, ...imgs].slice(0, MAX_IMAGES));
    } catch {
      notify("err", "Couldn't read that image");
    }
  }

  // ⌘V a screenshot anywhere on the page.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function analyse() {
    setBusy("draft");
    try {
      const d = await draftFromPost(settings, Boolean(resume), text, images.map(({ format, base64 }) => ({ format, base64 })));
      setDraft(d);
      setTo(splitEmails([d.to, ...d.emails_found].join(", ")).join(", "));
      setSubject(d.subject);
      setBody(d.body);
      if (!d.is_job_post) notify("err", "That doesn't look like a job post");
    } catch (e) {
      notify("err", `Draft failed: ${friendlyAiError(e)}`);
    } finally {
      setBusy("");
    }
  }

  const attachment = attachResume ? resume : null;

  async function sendTest() {
    setBusy("test");
    try {
      await sendOne(settings, { to: settings.testTo.trim(), subject: `[TEST] ${subject}`, text: body }, attachment);
      notify("ok", `Test sent to ${settings.testTo}`);
    } catch (e) {
      notify("err", `Test failed: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  // Same mail, sent separately to each address in "To".
  async function sendAll() {
    const targets = splitEmails(to);
    const bad = targets.filter((t) => !EMAIL_RE.test(t));
    if (!targets.length || bad.length) {
      notify("err", bad.length ? `Not a valid email: ${bad.join(", ")}` : "Add a recipient");
      return;
    }
    const before = new Set(loadSent().map((s) => s.to.toLowerCase()));
    const dups = targets.filter((t) => before.has(t.toLowerCase()));
    const msg =
      `Send to:\n${targets.join("\n")}\n\n` +
      (attachment ? `With ${attachment.filename}` : "No resume attached") +
      (dups.length ? `\n\nAlready emailed before: ${dups.join(", ")}` : "");
    if (!window.confirm(msg)) return;

    setBusy("send");
    const ok: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (targets.length > 1) notify("info", `Sending ${i + 1} of ${targets.length}…`);
      try {
        await sendOne(settings, { to: target, subject, text: body }, attachment);
        ok.push(target);
        recordSent({ to: target, subject, at: new Date().toISOString() });
      } catch (e) {
        failed.push(`${target} (${(e as Error).message})`);
      }
      if (i < targets.length - 1) await sleep(SEND_GAP_MS);
    }
    setBusy("");
    if (failed.length) notify("err", `${ok.length ? `Sent ${ok.length}. ` : ""}Failed: ${failed.join("; ")}`);
    else notify("ok", `Sent to ${ok.join(", ")}`);
  }

  function reset() {
    setImages([]);
    setText("");
    setDraft(null);
    setTo("");
    setSubject("");
    setBody("");
  }

  const targets = splitEmails(to);
  const canDraft = !draftMissing.length && !busy && (text.trim() || images.length);

  return (
    <div className="grid">
      <div>
        <div
          className={`card composer${dragging ? " drag" : ""}${images.length ? " has-img" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <textarea
            placeholder="Paste the job post, or drop / ⌘V a screenshot"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canDraft) analyse();
            }}
          />
          {images.length > 0 && (
            <div className="thumbs">
              {images.map((img) => (
                <div key={img.id} className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="Screenshot" />
                  <button onClick={() => setImages((l) => l.filter((x) => x.id !== img.id))} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="bar">
            <button className="ghost icon" onClick={() => fileRef.current?.click()} title="Add screenshot" disabled={images.length >= MAX_IMAGES}>
              {Icon.image}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {(draft || text || images.length > 0) && (
              <button className="ghost small" onClick={reset} disabled={!!busy}>Clear</button>
            )}
            <span className="spacer" />
            <button className="primary" onClick={analyse} disabled={!canDraft}>
              {busy === "draft" ? <><span className="spin" /> Reading…</> : draft ? "Redraft" : "Draft email"}
            </button>
          </div>
        </div>

        {draftMissing.length > 0 && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            To draft, add {draftMissing.join(", ")} in <button className="link" onClick={openSettings}>Settings</button>.
          </div>
        )}

        {draft?.is_job_post && (
          <div className="card card-pad stack">
            <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="role">
                  {draft.role || "Role"}
                  {draft.company && <span className="muted" style={{ fontWeight: 400 }}> · {draft.company}</span>}
                </div>
                <div className="meta">{[draft.location, draft.contact_name].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="spacer" />
              <span className={`pill ${draft.fit}`}>{draft.fit} fit</span>
            </div>
            {!draft.emails_found.length && draft.apply_note && <div className="notice warn">{draft.apply_note}</div>}
            {draft.matches.length > 0 && (
              <div>
                <div className="section-label">Matches</div>
                <div className="chips">{draft.matches.map((m, i) => <span key={i} className="chip ok">{m}</span>)}</div>
              </div>
            )}
            {draft.gaps.length > 0 && (
              <div>
                <div className="section-label">Gaps</div>
                <div className="chips">{draft.gaps.map((m, i) => <span key={i} className="chip warn">{m}</span>)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        {draft && (draft.subject || draft.body) ? (
          <>
            <label className="field">
              <span>To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@company.com" />
              {targets.length > 1 && <span className="pill" style={{ width: "auto" }}>{targets.length}</span>}
            </label>
            <label className="field">
              <span>Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <textarea className="mail-body" value={body} onChange={(e) => setBody(e.target.value)} />
            {sendMissing.length > 0 && (
              <div className="notice warn" style={{ margin: "0 12px 10px" }}>
                To send, add {sendMissing.join(", ")} in <button className="link" onClick={openSettings}>Settings</button>. You can still copy the email.
              </div>
            )}
            <div className="bar">
              {resume && (
                <button
                  className={`attach${attachResume ? " on" : ""}`}
                  onClick={() => setAttachResume((v) => !v)}
                  title={attachResume ? "Click to remove" : "Click to attach"}
                >
                  {Icon.clip} {attachResume ? "Resume" : "No resume"}
                </button>
              )}
              <span className="muted small">{wordCount(body, settings.signature)} words</span>
              <span className="spacer" />
              <button
                className="ghost"
                onClick={() => navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => notify("ok", "Copied"))}
                disabled={!body}
              >
                Copy
              </button>
              <button
                className="ghost"
                onClick={sendTest}
                disabled={!!busy || !!sendMissing.length || !EMAIL_RE.test(settings.testTo.trim()) || !subject || !body}
                title={settings.testTo ? `Send to ${settings.testTo}` : "Set a test address in Settings"}
              >
                {busy === "test" ? <span className="spin" /> : "Test"}
              </button>
              <button className="primary" onClick={sendAll} disabled={!!busy || !!sendMissing.length || !targets.length || !subject || !body}>
                {busy === "send" ? <span className="spin" /> : Icon.send}
                {targets.length > 1 ? `Send to ${targets.length}` : "Send"}
              </button>
            </div>
          </>
        ) : (
          <div className="empty">
            <div>
              {Icon.mail}
              <div>{busy === "draft" ? "Writing your email…" : "Your email shows up here"}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
