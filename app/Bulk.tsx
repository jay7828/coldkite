"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { missingForSend, type Resume, type Settings } from "@/lib/settings";
import { EMAIL_RE, SEND_GAP_MS, loadSent, recordSent, sendOne, sleep } from "@/lib/send";
import type { Notify } from "./JobDraft";

type Status = "pending" | "sending" | "sent" | "failed";
type Recipient = {
  id: string;
  email: string;
  name: string;
  company: string;
  selected: boolean;
  status: Status;
  error?: string;
  sentAt?: string;
};

const STORAGE_KEY = "coldkite:bulk:v1";

const DEFAULT_SUBJECT = "Interested in engineering roles at {{company}}";
const DEFAULT_BODY = `Hi {{first_name}},

I've been following what you're building at {{company}} and would love to contribute.

<One or two sentences about what you've built that fits.>

My resume is attached. If there's a role open, or you'd be up for a quick 15-minute chat, I'd be glad to talk.`;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function fillTemplate(tpl: string, r: Pick<Recipient, "name" | "company" | "email">): string {
  const vars: Record<string, string> = {
    name: r.name.trim(),
    // No name (e.g. a careers@ inbox) → "Hi Acme team".
    first_name: firstName(r.name) || (r.company.trim() ? `${r.company.trim()} team` : ""),
    company: r.company.trim(),
    email: r.email,
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => vars[key.toLowerCase()] ?? m);
}

function missingVars(tpl: string, r: Recipient): string[] {
  const missing = new Set<string>();
  for (const [, key] of tpl.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const k = key.toLowerCase();
    if (k === "name" && !r.name.trim()) missing.add("name");
    if (k === "first_name" && !r.name.trim() && !r.company.trim()) missing.add("name");
    if (k === "company" && !r.company.trim()) missing.add("company");
  }
  return [...missing];
}

// Accepts "email,name,company" (comma or tab separated, header optional) or "Name <email>" per line.
function parseRecipients(input: string): { rows: Omit<Recipient, "id" | "selected" | "status">[]; skipped: number } {
  const rows: Omit<Recipient, "id" | "selected" | "status">[] = [];
  let skipped = 0;
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const angle = line.match(/^(.*)<([^>]+)>\s*,?\s*(.*)$/);
    if (angle) {
      const email = angle[2].trim();
      if (EMAIL_RE.test(email)) {
        rows.push({ email, name: angle[1].replace(/[",]/g, "").trim(), company: angle[3].trim() });
        continue;
      }
    }
    const cells = line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const emailIdx = cells.findIndex((c) => EMAIL_RE.test(c));
    if (emailIdx === -1) {
      skipped++;
      continue;
    }
    const rest = cells.filter((_, i) => i !== emailIdx);
    rows.push({ email: cells[emailIdx], name: rest[0] ?? "", company: rest[1] ?? "" });
  }
  return { rows, skipped };
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Bulk({
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
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [importText, setImportText] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attachResume, setAttachResume] = useState(Boolean(resume));
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);
  const loaded = useRef(false);

  const signature = settings.signature.trim();
  const fullBody = signature ? `${body.trimEnd()}\n\n${signature}` : body;
  const sendMissing = missingForSend(settings);

  useEffect(() => setAttachResume(Boolean(resume)), [resume]);

  // Restore saved work from this browser.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved) {
        setRecipients((saved.recipients ?? []).map((r: Recipient) => ({ ...r, status: r.status === "sending" ? "pending" : r.status })));
        if (saved.subject) setSubject(saved.subject);
        if (saved.body) setBody(saved.body);
      }
    } catch {
      /* storage unavailable: start fresh */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ recipients, subject, body }));
    } catch {
      /* ignore */
    }
  }, [recipients, subject, body]);

  const previewRecipient = useMemo(
    () => recipients.find((r) => r.id === previewId) ?? recipients.find((r) => r.selected) ?? recipients[0],
    [recipients, previewId],
  );
  const queue = recipients.filter((r) => r.selected && r.status !== "sent");
  const counts = {
    total: recipients.length,
    sent: recipients.filter((r) => r.status === "sent").length,
    failed: recipients.filter((r) => r.status === "failed").length,
  };

  function update(id: string, patch: Partial<Recipient>) {
    setRecipients((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function importRecipients() {
    const { rows, skipped } = parseRecipients(importText);
    const existing = new Set(recipients.map((r) => r.email.toLowerCase()));
    const fresh = rows.filter((r) => {
      const key = r.email.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    setRecipients((list) => [...list, ...fresh.map((r) => ({ ...r, id: uid(), selected: true, status: "pending" as Status }))]);
    setImportText("");
    const dupes = rows.length - fresh.length;
    notify(
      fresh.length ? "ok" : "err",
      `Added ${fresh.length} recipient${fresh.length === 1 ? "" : "s"}` +
        (dupes ? `, ${dupes} duplicate${dupes === 1 ? "" : "s"} ignored` : "") +
        (skipped ? `, ${skipped} line${skipped === 1 ? "" : "s"} without an email skipped` : "") + ".",
    );
  }

  const attachment = attachResume ? resume : null;

  async function sendTest() {
    const r = previewRecipient ?? { name: "Alex Example", company: "Example Co", email: settings.testTo };
    notify("info", "Sending test…");
    try {
      await sendOne(settings, { to: settings.testTo.trim(), subject: `[TEST] ${fillTemplate(subject, r)}`, text: fillTemplate(fullBody, r) }, attachment);
      notify("ok", `Test sent to ${settings.testTo}. Check your inbox.`);
    } catch (e) {
      notify("err", `Test failed: ${(e as Error).message}`);
    }
  }

  async function sendAll() {
    if (!queue.length) return;
    const incomplete = queue.filter((r) => missingVars(subject + body, r).length);
    const before = new Set(loadSent().map((s) => s.to.toLowerCase()));
    const dups = queue.filter((r) => before.has(r.email.toLowerCase())).length;
    const msg =
      `Send ${queue.length} email(s) from ${settings.fromAddress || settings.gmailUser}?` +
      (attachment ? `\nResume attached: ${attachment.filename}` : "\nNo resume attached.") +
      (incomplete.length ? `\n\n${incomplete.length} recipient(s) are missing a name or company used in the template.` : "") +
      (dups ? `\n\n${dups} of them were emailed from this browser before.` : "");
    if (!window.confirm(msg)) return;

    stopRef.current = false;
    setSending(true);
    setProgress({ done: 0, total: queue.length });
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) break;
      const r = queue[i];
      update(r.id, { status: "sending", error: undefined });
      try {
        const subj = fillTemplate(subject, r);
        await sendOne(settings, { to: r.email, subject: subj, text: fillTemplate(fullBody, r) }, attachment);
        update(r.id, { status: "sent", sentAt: new Date().toISOString(), selected: false });
        recordSent({ to: r.email, subject: subj, at: new Date().toISOString() });
        sent++;
      } catch (e) {
        update(r.id, { status: "failed", error: (e as Error).message });
        failed++;
      }
      setProgress({ done: i + 1, total: queue.length });
      if (i < queue.length - 1 && !stopRef.current) await sleep(SEND_GAP_MS);
    }
    setSending(false);
    notify(failed ? "err" : "ok", `${stopRef.current ? "Stopped. " : ""}${sent} sent${failed ? `, ${failed} failed (see the table)` : ""}.`);
  }

  function exportCsv() {
    const header = "email,name,company,status,sent_at,error";
    const esc = (s = "") => `"${s.replace(/"/g, '""')}"`;
    const lines = recipients.map((r) => [r.email, r.name, r.company, r.status, r.sentAt, r.error].map(esc).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "coldkite-recipients.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const allSelected = recipients.length > 0 && recipients.every((r) => r.selected);

  return (
    <div className="grid even">
      <div className="card">
        <div className="card-head">
          <h2>Recipients</h2>
          <span className="spacer" />
          {counts.total > 0 && (
            <span className="muted small">
              {counts.total} · {counts.sent} sent{counts.failed ? ` · ${counts.failed} failed` : ""}
            </span>
          )}
        </div>
        <div className="card-pad stack">
          <textarea rows={4} placeholder={"email, name, company\nsara@acme.com, Sara Khan, Acme"} value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div className="row">
            <button onClick={importRecipients} disabled={!importText.trim()}>Add</button>
            <span className="spacer" />
            {counts.sent > 0 && (
              <button className="ghost small" onClick={() => setRecipients((l) => l.filter((r) => r.status !== "sent"))} disabled={sending}>Clear sent</button>
            )}
            {recipients.length > 0 && <button className="ghost small" onClick={exportCsv}>Export</button>}
          </div>
          {recipients.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" style={{ width: "auto" }} checked={allSelected} onChange={() => setRecipients((l) => l.map((r) => ({ ...r, selected: !allSelected })))} aria-label="Select all" />
                    </th>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => (
                    <tr key={r.id} className={r.id === previewRecipient?.id ? "active" : ""} onClick={() => setPreviewId(r.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" style={{ width: "auto" }} checked={r.selected} disabled={sending} onChange={(e) => update(r.id, { selected: e.target.checked })} aria-label={`Select ${r.email}`} />
                      </td>
                      <td className="email" title={r.email}>{r.email}</td>
                      <td>{r.name || <span className="muted">—</span>}</td>
                      <td>{r.company || <span className="muted">—</span>}</td>
                      <td><span className={`pill ${r.status}`} title={r.error}>{r.status}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="ghost icon small" disabled={sending} onClick={() => setRecipients((l) => l.filter((x) => x.id !== r.id))} aria-label="Remove">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <label className="field">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sending} />
        </label>
        <textarea className="mail-body" style={{ minHeight: 260 }} value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} />
        <div className="bar">
          {resume && (
            <button className={`attach${attachResume ? " on" : ""}`} onClick={() => setAttachResume((v) => !v)} disabled={sending}>
              📎 {attachResume ? "Resume" : "No resume"}
            </button>
          )}
          <span className="muted small" title="Placeholders">{"{{first_name}} {{company}}"}{signature ? " · signature added" : ""}</span>
        </div>
        {previewRecipient && (
          <div className="card-pad stack" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="section-label">Preview · {previewRecipient.email}</div>
            <div className="preview">
              <div className="subject">{fillTemplate(subject, previewRecipient)}</div>
              {fillTemplate(fullBody, previewRecipient)}
            </div>
            {missingVars(subject + body, previewRecipient).length > 0 && (
              <div className="notice err">Missing {missingVars(subject + body, previewRecipient).join(" and ")}</div>
            )}
          </div>
        )}
        {sendMissing.length > 0 && (
          <div className="notice warn" style={{ margin: "0 12px 10px" }}>
            To send, add {sendMissing.join(", ")} in <button className="link" onClick={openSettings}>Settings</button>.
          </div>
        )}
        {sending && (
          <div style={{ padding: "0 18px 12px" }}>
            <div className="progress"><div style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div>
          </div>
        )}
        <div className="bar">
          <span className="spacer" />
          <button className="ghost" onClick={sendTest} disabled={sending || !!sendMissing.length || !EMAIL_RE.test(settings.testTo.trim())}>Test</button>
          {sending ? (
            <button onClick={() => (stopRef.current = true)}>Stop · {progress.done}/{progress.total}</button>
          ) : (
            <button className="primary" onClick={sendAll} disabled={!queue.length || !!sendMissing.length}>Send to {queue.length}</button>
          )}
        </div>
      </div>
    </div>
  );
}
