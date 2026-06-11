"use client";
import { useState } from "react";
import ConfigBanner from "../components/ConfigBanner";

export default function AddPage() {
  const [reelText, setReelText] = useState("");
  const [reelTarget, setReelTarget] = useState<"inspiration" | "our">("inspiration");
  const [reelBusy, setReelBusy] = useState(false);
  const [reelLog, setReelLog] = useState<string[]>([]);

  const [user, setUser] = useState("");
  const [acctTarget, setAcctTarget] = useState<"inspiration" | "our">("inspiration");
  const [why, setWhy] = useState("");
  const [niche, setNiche] = useState("");
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMsg, setAcctMsg] = useState("");

  async function scrapeReels() {
    const urls = reelText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    setReelBusy(true);
    setReelLog([`Scraping ${urls.length} reel(s)…`]);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, target: reelTarget }),
      });
      const json = await res.json();
      if (json.error) {
        setReelLog((l) => [...l, `Error: ${json.error}`]);
      } else {
        const lines = (json.results || []).map((r: any) =>
          r.ok
            ? `✓ @${r.handle || "?"} — ${r.views?.toLocaleString?.() || 0} views ${r.created ? "(added)" : "(updated)"}`
            : `✗ ${r.url} — ${r.error}`
        );
        setReelLog((l) => [...l, ...lines, "Done."]);
        setReelText("");
      }
    } catch (e: any) {
      setReelLog((l) => [...l, `Error: ${e.message}`]);
    }
    setReelBusy(false);
  }

  async function scrapeAccount() {
    if (!user.trim()) return;
    setAcctBusy(true);
    setAcctMsg("");
    try {
      const res = await fetch("/api/scrape-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, target: acctTarget, why, niche }),
      });
      const json = await res.json();
      setAcctMsg(json.error ? `Error: ${json.error}` : `✓ Saved @${json.profile?.username} (${json.profile?.followers?.toLocaleString?.()} followers)`);
      if (!json.error) { setUser(""); setWhy(""); setNiche(""); }
    } catch (e: any) {
      setAcctMsg(`Error: ${e.message}`);
    }
    setAcctBusy(false);
  }

  return (
    <div>
      <h1 className="h1">Add / Scrape</h1>
      <p className="sub">Paste reel links or an account handle. Metadata is scraped via RockSolidAPIs and saved to Airtable.</p>
      <ConfigBanner />

      <div className="panel">
        <h2>Scrape reels</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Paste one or many Instagram reel URLs (space, comma or newline separated).
        </p>
        <textarea
          placeholder="https://www.instagram.com/reel/ABC123/&#10;https://www.instagram.com/reel/XYZ789/"
          value={reelText}
          onChange={(e) => setReelText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <select value={reelTarget} onChange={(e) => setReelTarget(e.target.value as any)}>
            <option value="inspiration">Save to Inspiration Reels</option>
            <option value="our">Save to Our Reels</option>
          </select>
          <button onClick={scrapeReels} disabled={reelBusy}>
            {reelBusy ? <><span className="spinner" /> Scraping…</> : "Scrape & save"}
          </button>
        </div>
        {reelLog.length > 0 && <div className="log" style={{ marginTop: 14 }}>{reelLog.join("\n")}</div>}
      </div>

      <div className="panel">
        <h2>Add an account</h2>
        <div className="row">
          <input placeholder="@handle" value={user} onChange={(e) => setUser(e.target.value)} style={{ minWidth: 200 }} />
          <select value={acctTarget} onChange={(e) => setAcctTarget(e.target.value as any)}>
            <option value="inspiration">Inspiration account</option>
            <option value="our">Our account</option>
          </select>
          <input placeholder="niche (optional)" value={niche} onChange={(e) => setNiche(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input placeholder="why saved / notes (optional)" value={why} onChange={(e) => setWhy(e.target.value)} style={{ flex: 1, minWidth: 260 }} />
          <button onClick={scrapeAccount} disabled={acctBusy}>
            {acctBusy ? <><span className="spinner" /> Saving…</> : "Add account"}
          </button>
        </div>
        {acctMsg && <p className="muted" style={{ marginTop: 12 }}>{acctMsg}</p>}
      </div>
    </div>
  );
}
