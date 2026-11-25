"use client";

import { useEffect, useRef, useState } from "react";
import JobDraft, { type Notify } from "./JobDraft";
import Bulk from "./Bulk";
import SettingsPanel from "./SettingsPanel";
import {
  EMPTY_SETTINGS,
  loadResume,
  loadSettings,
  missingForDraft,
  saveResume,
  saveSettings,
  senderOf,
  type Resume,
  type Settings,
} from "@/lib/settings";

type Tab = "post" | "bulk" | "settings";
const TAB_KEY = "coldkite:tab";

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [resume, setResume] = useState<Resume | null>(null);
  const [tab, setTab] = useState<Tab>("post");
  const [notice, setNoticeState] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setResume(loadResume());
    let t: Tab = "post";
    try {
      if (localStorage.getItem(TAB_KEY) === "bulk") t = "bulk";
    } catch {
      /* ignore */
    }
    // First visit: start on Settings so people know what to fill in.
    setTab(missingForDraft(s).length === 3 ? "settings" : t);
    setReady(true);
  }, []);

  function switchTab(t: Tab) {
    setTab(t);
    if (t === "settings") return;
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  }

  const notify: Notify = (kind, text) => {
    setNoticeState({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (kind !== "err") toastTimer.current = setTimeout(() => setNoticeState(null), 5000);
  };

  function save(s: Settings, r: Resume | null) {
    const ok = saveSettings(s) && saveResume(r);
    setSettings(s);
    setResume(r);
    if (ok) {
      notify("ok", "Saved in this browser");
      switchTab("post");
    } else {
      notify("err", "This browser blocked storage, so settings last only until you close the tab.");
    }
  }

  const sender = senderOf(settings);

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21 21 3" /><path d="M21 3 10 6l4 4z" /><path d="M7 17c-2 0-3 1-4 4" /></svg>
          </span>
          <span>Coldkite</span>
        </div>
        <nav className="tabs">
          <button className={tab === "post" ? "on" : ""} onClick={() => switchTab("post")}>Job post</button>
          <button className={tab === "bulk" ? "on" : ""} onClick={() => switchTab("bulk")}>Bulk</button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => switchTab("settings")}>Settings</button>
        </nav>
        {sender && <span className="who">{sender}</span>}
        <a className="ghost-link small" href="https://github.com/jay7828/coldkite" target="_blank" rel="noreferrer">GitHub</a>
      </header>

      {!ready ? null : tab === "settings" ? (
        <SettingsPanel
          key={JSON.stringify(settings) + (resume?.filename ?? "")}
          initial={settings}
          resume={resume}
          onSave={save}
          onClose={missingForDraft(settings).length === 3 ? undefined : () => switchTab("post")}
        />
      ) : tab === "post" ? (
        <JobDraft settings={settings} resume={resume} notify={notify} openSettings={() => switchTab("settings")} />
      ) : (
        <Bulk settings={settings} resume={resume} notify={notify} openSettings={() => switchTab("settings")} />
      )}

      {notice && (
        <div className={`toast ${notice.kind === "info" ? "" : notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button onClick={() => setNoticeState(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </main>
  );
}
