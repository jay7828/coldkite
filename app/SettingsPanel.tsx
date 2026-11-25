"use client";

import { useRef, useState } from "react";
import {
  MODELS,
  PROFILE_PLACEHOLDER,
  clearEverything,
  type Resume,
  type Settings,
} from "@/lib/settings";
import { buildSystemPrompt } from "@/lib/ai";

const MAX_PDF_BYTES = 2_200_000;

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="setting">
      <span className="setting-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export default function SettingsPanel({
  initial,
  resume,
  onSave,
  onClose,
}: {
  initial: Settings;
  resume: Resume | null;
  onSave: (s: Settings, r: Resume | null) => void;
  onClose?: () => void;
}) {
  const [s, setS] = useState<Settings>(initial);
  const [r, setR] = useState<Resume | null>(resume);
  const [err, setErr] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((cur) => ({ ...cur, [k]: v }));

  async function pickPdf(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf") return setErr("The resume must be a PDF.");
    if (file.size > MAX_PDF_BYTES) return setErr("That PDF is over 2 MB. Export a smaller one.");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    setR({ filename: file.name, base64: btoa(bin) });
    setErr("");
  }

  function wipe() {
    if (!window.confirm("Remove every Coldkite setting, key, resume and log from this browser?")) return;
    clearEverything();
    window.location.reload();
  }

  return (
    <div className="settings">
      <div className="notice">
        Everything you enter here is saved <b>only in this browser</b> (localStorage). Your Anthropic key is
        sent straight from your browser to Anthropic. Your mail login is passed through the Coldkite server
        for each send and is never stored there. Prefer zero trust? <a href="https://github.com/jay7828/coldkite" target="_blank" rel="noreferrer">Run it yourself</a>.
      </div>

      <section className="card card-pad stack">
        <h2>1 · About you</h2>
        <Field label="Your name">
          <input value={s.name} onChange={(e) => set("name", e.target.value)} placeholder="Alex Rivera" />
        </Field>
        <Field label="Profile" hint="The AI writes using only these facts. Paste your resume text, projects and where you can work.">
          <textarea rows={12} value={s.profile} onChange={(e) => set("profile", e.target.value)} placeholder={PROFILE_PLACEHOLDER} />
        </Field>
        <Field label="Signature" hint="Ends every email exactly as written.">
          <textarea rows={3} value={s.signature} onChange={(e) => set("signature", e.target.value)} placeholder={"Best,\nAlex Rivera\nalex@example.com · +351 900 000 000"} />
        </Field>
        <Field label="Closing line (optional)" hint="Added on its own line before the signature.">
          <input value={s.closingLine} onChange={(e) => set("closingLine", e.target.value)} placeholder="You can see my work at https://alex.dev" />
        </Field>
        <Field label="Extra instructions (optional)">
          <textarea rows={3} value={s.extraRules} onChange={(e) => set("extraRules", e.target.value)} placeholder="e.g. Write in British English. Mention I can start in two weeks." />
        </Field>
        <Field label="Resume (optional PDF, max 2 MB)">
          <div className="row">
            <button type="button" onClick={() => fileRef.current?.click()}>{r ? "Replace PDF" : "Choose PDF"}</button>
            {r && <span className="muted small">{r.filename}</span>}
            {r && <button type="button" className="ghost small" onClick={() => setR(null)}>Remove</button>}
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { pickPdf(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </Field>
      </section>

      <section className="card card-pad stack">
        <h2>2 · AI drafting</h2>
        <Field label="Anthropic API key" hint={<>Get one at <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a>. You pay Anthropic directly for what you use.</>}>
          <input type="password" autoComplete="off" value={s.anthropicKey} onChange={(e) => set("anthropicKey", e.target.value)} placeholder="sk-ant-..." />
        </Field>
        <Field label="Model">
          <select value={s.model} onChange={(e) => set("model", e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <button type="button" className="ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? "Hide" : "Show"} the prompt the AI gets
        </button>
        {showPrompt && <pre className="preview prompt">{buildSystemPrompt(s.name ? s : { ...s, name: "You" }, Boolean(r))}</pre>}
      </section>

      <section className="card card-pad stack">
        <h2>3 · Sending</h2>
        <div className="tabs" style={{ margin: 0, alignSelf: "flex-start" }}>
          <button type="button" className={s.provider === "gmail" ? "on" : ""} onClick={() => set("provider", "gmail")}>Gmail</button>
          <button type="button" className={s.provider === "resend" ? "on" : ""} onClick={() => set("provider", "resend")}>Resend</button>
        </div>
        {s.provider === "gmail" ? (
          <>
            <Field label="Gmail address">
              <input value={s.gmailUser} onChange={(e) => set("gmailUser", e.target.value)} placeholder="you@gmail.com" />
            </Field>
            <Field label="Gmail app password" hint={<>Not your normal password. Turn on 2-step verification, then create one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>. Gmail allows about 500 emails a day.</>}>
              <input type="password" autoComplete="off" value={s.gmailAppPassword} onChange={(e) => set("gmailAppPassword", e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
            </Field>
            <Field label="From name (optional)">
              <input value={s.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder={`${s.name || "Alex Rivera"} <${s.gmailUser || "you@gmail.com"}>`} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Resend API key" hint={<>From <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">resend.com</a>. You need a verified domain to mail anyone but yourself.</>}>
              <input type="password" autoComplete="off" value={s.resendKey} onChange={(e) => set("resendKey", e.target.value)} placeholder="re_..." />
            </Field>
            <Field label="From address">
              <input value={s.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} placeholder="Alex Rivera <alex@yourdomain.com>" />
            </Field>
          </>
        )}
        <Field label="Test address" hint="Where the Test button sends.">
          <input value={s.testTo} onChange={(e) => set("testTo", e.target.value)} placeholder="you@gmail.com" />
        </Field>
      </section>

      {err && <div className="notice err">{err}</div>}
      <div className="row">
        <button className="ghost small danger" type="button" onClick={wipe}>Clear all data</button>
        <span className="spacer" />
        {onClose && <button type="button" className="ghost" onClick={onClose}>Cancel</button>}
        <button type="button" className="primary" onClick={() => onSave(s, r)}>Save</button>
      </div>
    </div>
  );
}
