"use client";
import { useEffect, useMemo, useState } from "react";
import ReelCard from "../components/ReelCard";
import ConfigBanner from "../components/ConfigBanner";
import NicheCombo from "../components/NicheCombo";

const TRAYS = ["regular", "spam", "pipeline"];

export default function InspirationPage() {
  const [recs, setRecs] = useState<any[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(50);

  const [filterNiche, setFilterNiche] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("Score");

  // add-reels box
  const [paste, setPaste] = useState("");
  const [pasteNiche, setPasteNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // scrape whole accounts (batch of profile links / usernames)
  const [scrapeText, setScrapeText] = useState("");
  const [scraping, setScraping] = useState(false);

  // per-reel tagging in-flight
  const [tagging, setTagging] = useState<Record<string, boolean>>({});

  // AI categorization
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const [batchAi, setBatchAi] = useState(false);

  // bulk selection
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkNiche, setBulkNiche] = useState("");
  const [bulkTray, setBulkTray] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  function loadNiches() {
    fetch("/api/niches").then((r) => r.json()).then((j) => {
      const names = (j.niches || []).map((n: any) => n.name);
      setNiches(names);
      if (!pasteNiche && names.length) setPasteNiche(names[0]);
    });
  }
  function loadReels() {
    setLoading(true);
    fetch(`/api/reels?type=inspiration&niche=${encodeURIComponent(filterNiche)}&contentType=${typeFilter}&format=${formatFilter}`)
      .then((r) => r.json())
      .then((j) => {
        setRecs(j.records || []);
        setVisible(50);
        setSel(new Set());
        setLoading(false);
      });
  }
  useEffect(loadNiches, []);
  useEffect(loadReels, [filterNiche, typeFilter, formatFilter]);

  async function addReels() {
    if (!paste.trim()) { setMsg("Paste some reel links first."); return; }
    if (!pasteNiche) { setMsg("Pick a niche for this batch."); return; }
    setBusy(true);
    setMsg("Scraping, downloading videos & scoring… this can take a minute for a big batch.");
    try {
      const res = await fetch("/api/inspiration/bulk-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: paste, niche: pasteNiche }),
      });
      const j = await res.json();
      if (j.error) setMsg(`Error: ${j.error}`);
      else {
        setMsg(`Added ${j.reels_added} reel(s) and ${j.accounts_added} account(s) to “${j.niche}”.${j.failed?.length ? ` ${j.failed.length} failed.` : ""}`);
        setPaste("");
        loadNiches();
        loadReels();
      }
    } catch (e: any) {
      setMsg(`Request ended (job may still be finishing server-side). Reload in a moment. (${e.message})`);
    }
    setBusy(false);
  }

  async function scrapeAccount() {
    if (!scrapeText.trim()) { setMsg("Paste at least one profile link or username."); return; }
    setScraping(true);
    setMsg("Scraping each account's top 25 reels into the library (untagged)… this can take a minute for several accounts.");
    try {
      const res = await fetch("/api/inspiration/scrape-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: scrapeText, count: 25 }),
      });
      const j = await res.json();
      if (j.error) setMsg(`Error: ${j.error}`);
      else {
        const failed = (j.results || []).filter((r: any) => r.error);
        setMsg(`Imported ${j.total_reels} reel(s) from ${j.accounts} account(s).` +
          (failed.length ? ` ${failed.length} couldn't be scraped: ${failed.map((f: any) => "@" + f.handle).join(", ")}.` : "") +
          (j.skipped?.length ? ` Skipped (over 12/batch): ${j.skipped.map((h: string) => "@" + h).join(", ")} — run again.` : ""));
        setScrapeText("");
        setFilterNiche("UNTAGGED");
        loadNiches();
        loadReels();
      }
    } catch (e: any) {
      setMsg(`Request ended (may still be finishing). Reload in a moment. (${e.message})`);
    }
    setScraping(false);
  }

  async function tagReel(reelUrl: string, niche: string) {
    setTagging((t) => ({ ...t, [reelUrl]: true }));
    // optimistic local update
    setRecs((rs) => rs.map((r) => (r.fields["Reel URL"] === reelUrl ? { ...r, fields: { ...r.fields, Niche: niche } } : r)));
    try {
      await fetch("/api/inspiration/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_url: reelUrl, niche }),
      });
      loadNiches();
      // if we're viewing a specific niche/untagged, refresh so the reel moves buckets
      if (filterNiche !== "ALL") loadReels();
    } catch {
      /* keep optimistic state */
    }
    setTagging((t) => ({ ...t, [reelUrl]: false }));
  }

  async function aiCategorizeOne(reelUrl: string) {
    setAiBusy((b) => ({ ...b, [reelUrl]: true }));
    try {
      const res = await fetch("/api/inspiration/ai-categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_url: reelUrl }),
      });
      const j = await res.json();
      if (j.error) setMsg(`AI error: ${j.error}`);
      else loadReels();
    } catch (e: any) {
      setMsg(`AI request ended: ${e.message}`);
    }
    setAiBusy((b) => ({ ...b, [reelUrl]: false }));
  }

  async function autoCategorizeUntagged() {
    setBatchAi(true);
    setMsg("Gemini is watching untagged reels and suggesting niches… (a batch at a time)");
    try {
      const res = await fetch("/api/inspiration/ai-categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 8, handle: filterNiche === "UNTAGGED" ? undefined : undefined }),
      });
      const j = await res.json();
      if (j.error) setMsg(`AI error: ${j.error}`);
      else setMsg(`Gemini suggested niches for ${j.categorized} reel(s).${j.failed?.length ? ` ${j.failed.length} failed.` : ""} Run again for more. Review & Accept below.`);
      loadReels();
    } catch (e: any) {
      setMsg(`AI batch ended (may still be finishing). Reload shortly. (${e.message})`);
    }
    setBatchAi(false);
  }

  function toggleSel(url: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(url) ? n.delete(url) : n.add(url);
      return n;
    });
  }

  async function bulkDelete() {
    const urls = [...sel];
    if (!urls.length) return;
    if (!confirm(`Delete ${urls.length} reel(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    setMsg("Deleting…");
    try {
      const res = await fetch("/api/inspiration-reels/manage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_urls: urls }),
      });
      const j = await res.json();
      setMsg(j.deleted != null ? `Deleted ${j.deleted} reel(s).` : `Error: ${j.error}`);
      loadReels();
    } catch (e: any) {
      setMsg(`Delete failed: ${e.message}`);
    }
    setBulkBusy(false);
  }

  async function bulkApply(patch: { niche?: string; tray?: string }) {
    const urls = [...sel];
    if (!urls.length) return;
    setBulkBusy(true);
    setMsg("Applying…");
    try {
      const res = await fetch("/api/inspiration-library/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_urls: urls, ...patch }),
      });
      const j = await res.json();
      if (j.error) setMsg(`Error: ${j.error}`);
      else {
        setMsg(`Updated ${j.reels_tagged} reel(s).`);
        loadNiches();
        loadReels();
      }
    } catch (e: any) {
      setMsg(`Request failed: ${e.message}`);
    }
    setBulkBusy(false);
  }

  const filtered = useMemo(() => {
    let r = recs;
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) => {
        const f = x.fields;
        return (
          (f["Author Handle"] || "").toLowerCase().includes(s) ||
          (f.Caption || "").toLowerCase().includes(s) ||
          (f.Niche || "").toLowerCase().includes(s)
        );
      });
    }
    return [...r].sort((a, b) => Number(b.fields[sort] || 0) - Number(a.fields[sort] || 0));
  }, [recs, q, sort]);

  const shown = filtered.slice(0, visible);

  return (
    <div>
      <h1 className="h1">Inspiration Reels</h1>
      <p className="sub">Paste reels to auto-save the video + a stats snapshot, scored 0–10. Filter and organize by niche.</p>
      <ConfigBanner />

      {/* Add reels */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h2>Add reels to a niche</h2>
        <textarea
          placeholder="Paste 5–10 Instagram reel links here (any format, separated by spaces or new lines)…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          style={{ width: "100%", resize: "vertical", marginBottom: 10 }}
        />
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <NicheCombo
            value={pasteNiche}
            onChange={setPasteNiche}
            niches={niches}
            onCreate={loadNiches}
            placeholder="Pick or type a niche…"
            style={{ minWidth: 200 }}
          />
          <button onClick={addReels} disabled={busy}>
            {busy ? <><span className="spinner" /> Adding…</> : "+ Add to niche"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>Type a new niche name to create it on the fly.</span>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "14px 0 12px" }} />
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          Or mass-import accounts &mdash; paste profile links or usernames (one per line, up to 12 at a time). Each account&rsquo;s top 25 reels come in untagged, ready to triage:
        </div>
        <textarea
          placeholder={"https://instagram.com/tallgirlkimxo\n@tallchinesechick\nmarietemara"}
          value={scrapeText}
          onChange={(e) => setScrapeText(e.target.value)}
          rows={3}
          style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
        />
        <div className="row">
          <button className="secondary" onClick={scrapeAccount} disabled={scraping}>
            {scraping ? <><span className="spinner" /> Scraping accounts…</> : "⤓ Scrape accounts"}
          </button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
      </div>

      {/* Filters */}
      <div className="row" style={{ marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
        <select value={filterNiche} onChange={(e) => setFilterNiche(e.target.value)} style={{ minWidth: 170 }}>
          <option value="ALL">All niches</option>
          <option value="UNTAGGED">⚑ Untagged (to triage)</option>
          {niches.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="reel">Reels</option>
          <option value="photo">Photo posts</option>
          <option value="carousel">Carousels</option>
        </select>
        <select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)} title="Single- vs multi-person">
          <option value="all">All formats</option>
          <option value="single">👤 Single-person</option>
          <option value="multi">👥 Multi-person</option>
          <option value="unclassified">Unclassified</option>
        </select>
        <input placeholder="Search handle, caption…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="Score">Sort: Score</option>
          <option value="Views">Sort: Views</option>
          <option value="View/Follow Ratio">Sort: Views/Follower</option>
          <option value="Likes">Sort: Likes</option>
          <option value="Comments">Sort: Comments</option>
        </select>
        <button className="secondary" onClick={autoCategorizeUntagged} disabled={batchAi} title="Gemini watches untagged reels and suggests a niche for each">
          {batchAi ? <><span className="spinner" /> AI watching…</> : "✨ Auto-categorize untagged"}
        </button>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No reels in this niche yet. Paste some above to get started.</p>
      ) : (
        <>
          <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 12 }}>
            <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={shown.length > 0 && shown.every((r) => sel.has(r.fields["Reel URL"]))}
                onChange={(e) =>
                  setSel(e.target.checked ? new Set(shown.map((r) => r.fields["Reel URL"])) : new Set())
                }
              />
              Select all shown ({shown.length})
            </label>
            {sel.size > 0 && <span className="muted" style={{ fontSize: 13 }}>{sel.size} selected</span>}
          </div>

          <div className="grid-reels">{shown.map((r) => {
            const url = r.fields["Reel URL"];
            const checked = sel.has(url);
            return (
              <div key={r.id} style={{ position: "relative", outline: checked ? "2px solid var(--accent)" : "none", borderRadius: 12 }}>
                <label style={{ position: "absolute", top: 10, left: 10, zIndex: 5, background: "rgba(0,0,0,.6)", borderRadius: 6, padding: "3px 6px", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleSel(url)} />
                </label>
                <ReelCard
                  rec={r}
                  niches={niches}
                  onTag={tagReel}
                  tagging={!!tagging[url]}
                  onAiCategorize={aiCategorizeOne}
                  aiBusy={!!aiBusy[url]}
                />
              </div>
            );
          })}</div>
          {visible < filtered.length && (
            <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
              <button className="secondary" onClick={() => setVisible((v) => v + 50)}>
                Load more ({filtered.length - visible} left)
              </button>
            </div>
          )}
        </>
      )}

      {sel.size > 0 && (
        <div className="panel" style={{
          position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)",
          zIndex: 200, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
          boxShadow: "0 6px 24px rgba(0,0,0,.4)", padding: "12px 16px", maxWidth: "94%",
        }}>
          <b style={{ fontSize: 14 }}>{sel.size} selected</b>
          <button onClick={bulkDelete} disabled={bulkBusy} style={{ background: "#c0392b", color: "#fff" }}>
            🗑 Delete Selected ({sel.size})
          </button>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <NicheCombo
              value={bulkNiche}
              onChange={setBulkNiche}
              niches={niches}
              onCreate={loadNiches}
              placeholder="Set niche…"
              disabled={bulkBusy}
              style={{ width: 150 }}
            />
            <button className="secondary" disabled={bulkBusy || !bulkNiche.trim()} onClick={() => bulkApply({ niche: bulkNiche.trim() })}>Apply</button>
          </div>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <select value={bulkTray} onChange={(e) => setBulkTray(e.target.value)} disabled={bulkBusy}>
              <option value="">Set tray…</option>
              {TRAYS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="secondary" disabled={bulkBusy || !bulkTray} onClick={() => bulkApply({ tray: bulkTray })}>Apply</button>
          </div>
          <button className="secondary" onClick={() => setSel(new Set())}>Clear Selection</button>
        </div>
      )}
    </div>
  );
}
