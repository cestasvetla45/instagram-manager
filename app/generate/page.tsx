"use client";
import { useEffect, useMemo, useState } from "react";
import ConfigBanner from "../components/ConfigBanner";
import ReelCard from "../components/ReelCard";

const SORTS: { key: string; label: string }[] = [
  { key: "Views", label: "Views" },
  { key: "View/Follow Ratio", label: "Views / follower (reach)" },
  { key: "Engagement Rate", label: "Engagement rate" },
  { key: "Likes", label: "Likes" },
];

export default function Generate() {
  const [reels, setReels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [niche, setNiche] = useState<string>("");
  const [count, setCount] = useState<number>(9);
  const [sort, setSort] = useState<string>("Views");
  const [generated, setGenerated] = useState<any[] | null>(null);
  // Pipeline integration: create concept from a reel
  const [pipeMode, setPipeMode] = useState(false); // when true, clicking a reel opens the concept form
  const [pipeReel, setPipeReel] = useState<any | null>(null); // selected reel for concept creation
  const [pipeMsg, setPipeMsg] = useState("");
  // concept form fields
  const [cName, setCName] = useState("");
  const [cType, setCType] = useState("dance");
  const [cSubniche, setSubniche] = useState("");
  const [cNiche, setCNiche] = useState("");
  const [cPrompt, setCPrompt] = useState("");
  const [cHook, setCHook] = useState("");
  const [taxonomy, setTaxonomy] = useState<any[]>([]);
  const [nichesList, setNichesList] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/reels?type=inspiration")
      .then((r) => r.json())
      .then((j) => {
        setReels(j.records || []);
        setLoading(false);
      });
    fetch("/api/pipeline/taxonomy").then((r) => r.json()).then((j) => setTaxonomy(j.types || []));
    fetch("/api/niches").then((r) => r.json()).then((j) => setNichesList((j.niches || []).map((n: any) => n.name)));
  }, []);

  const niches = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of reels) {
      const n = String(r.fields["Niche"] || "").trim();
      if (!n) continue;
      counts[n] = (counts[n] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [reels]);

  useEffect(() => {
    if (!niche && niches.length) setNiche(niches[0][0]);
  }, [niches, niche]);

  function generate() {
    const pool = reels.filter(
      (r) => String(r.fields["Niche"] || "").trim().toLowerCase() === niche.toLowerCase()
    );
    const sorted = [...pool].sort(
      (a, b) => Number(b.fields[sort] || 0) - Number(a.fields[sort] || 0)
    );
    setGenerated(sorted.slice(0, count));
  }

  return (
    <div>
      <h1 className="h1">Inspiration Generator</h1>
      <p className="sub">Pick a niche and how many videos you want — get the highest-performing reels you've scraped in that niche.</p>
      <ConfigBanner />

      <div className="panel">
        <div className="row" style={{ alignItems: "flex-end", gap: 18 }}>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Niche</div>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} style={{ minWidth: 200 }}>
              {niches.length === 0 ? (
                <option value="">No niches yet</option>
              ) : (
                niches.map(([n, c]) => (
                  <option key={n} value={n}>
                    {n} ({c})
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>How many videos: <b style={{ color: "var(--text)" }}>{count}</b></div>
            <input type="range" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 220 }} />
          </div>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Rank by</div>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <button onClick={generate} disabled={!niche}>✦ Generate inspiration</button>
          <button
            className={pipeMode ? "" : "secondary"}
            onClick={() => { setPipeMode(!pipeMode); setPipeReel(null); }}
            title="Click reels to turn them into pipeline concepts"
          >
            🎯 {pipeMode ? "Cancel concept mode" : "Create concepts from reels"}
          </button>
        </div>
        {pipeMode && (
          <p className="muted" style={{ marginTop: 10, fontSize: 13, color: "var(--accent)" }}>
            🎯 Click any reel below to create a content concept from it.
          </p>
        )}
        {pipeMsg && <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{pipeMsg}</p>}
        {niches.length === 0 && !loading && (
          <p className="muted" style={{ marginTop: 14 }}>
            No niches found yet. Tag your inspiration accounts with a niche (on the Add / Scrape page) — reels inherit it automatically when scraped.
          </p>
        )}
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading your inspiration library…</p>
      ) : generated === null ? (
        <p className="muted">Choose a niche and hit Generate.</p>
      ) : generated.length === 0 ? (
        <p className="muted">No reels found in “{niche}”. Scrape more reels from accounts in this niche.</p>
      ) : (
        <>
          <p className="sub">Top {generated.length} in <b>{niche}</b> by {SORTS.find((s) => s.key === sort)?.label.toLowerCase()}.</p>
          <div className="grid-reels">
            {generated.map((r) => (
              <div
                key={r.id}
                onClick={pipeMode ? () => {
                  setPipeReel(r);
                  setCName(String(r.fields.Caption || "").slice(0, 60).split("\n")[0] || "");
                  setCNiche(String(r.fields.Niche || niche || ""));
                  setCPrompt("");
                  setCHook(String(r.fields.Caption || "").split("\n")[0] || "");
                } : undefined}
                style={pipeMode ? { cursor: "pointer", outline: pipeReel?.id === r.id ? "2px solid var(--accent)" : "none", borderRadius: 12 } : undefined}
              >
                <ReelCard rec={r} />
              </div>
            ))}
          </div>

          {/* Concept creation form (pipeline mode) */}
          {pipeMode && pipeReel && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h2>Create concept from this reel</h2>
              <div style={{ display: "grid", gap: 10, maxWidth: 600 }}>
                <div>
                  <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Concept name *</div>
                  <input value={cName} onChange={(e) => setCName(e.target.value)} style={{ width: "100%" }} placeholder="e.g. shower dance, gaze reaction" autoFocus />
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Content type</div>
                    <select value={cType} onChange={(e) => { setCType(e.target.value); setSubniche(""); }} style={{ width: "100%" }}>
                      {taxonomy.map((t: any) => <option key={t.id} value={t.name}>{t.label || t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Subniche (dance only)</div>
                    <select value={cSubniche} onChange={(e) => setSubniche(e.target.value)} style={{ width: "100%" }}>
                      <option value="">— none —</option>
                      {(taxonomy.find((t: any) => t.name === cType)?.subniches || []).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Niche</div>
                    <select value={cNiche} onChange={(e) => setCNiche(e.target.value)} style={{ width: "100%" }}>
                      <option value="">— none —</option>
                      {nichesList.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Visual prompt (for photo generation)</div>
                  <textarea value={cPrompt} onChange={(e) => setCPrompt(e.target.value)} rows={2} style={{ width: "100%", resize: "vertical" }} placeholder="Describe the visual for AI generation…" />
                </div>
                <div>
                  <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>Hook text</div>
                  <input value={cHook} onChange={(e) => setCHook(e.target.value)} style={{ width: "100%" }} placeholder="on-screen text / caption idea" />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    onClick={async () => {
                      if (!cName.trim()) { setPipeMsg("Concept name required."); return; }
                      const f = pipeReel.fields;
                      const res = await fetch("/api/pipeline/concepts", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: cName.trim(),
                          content_type: cType,
                          subniche: cSubniche || undefined,
                          niche: cNiche || undefined,
                          visual_prompt: cPrompt,
                          hook_text: cHook,
                          inspiration_reel_url: f["Reel URL"],
                          inspiration_thumbnail: f.Thumbnail?.[0]?.url || f.Thumbnail,
                          inspiration_account: f["Author Handle"],
                        }),
                      });
                      const j = await res.json();
                      if (j.error) { setPipeMsg(`Error: ${j.error}`); return; }
                      setPipeMsg(`✓ Concept "${cName}" created → view it in Content Pipeline`);
                      setPipeReel(null);
                      setCName(""); setCPrompt(""); setCHook("");
                    }}
                    disabled={!cName.trim()}
                  >
                    Create concept
                  </button>
                  <button className="secondary" onClick={() => setPipeReel(null)}>Cancel</button>
                  <a href="/pipeline" className="badge" style={{ marginLeft: "auto" }}>Go to pipeline →</a>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
