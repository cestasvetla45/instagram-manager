"use client";
import { useEffect, useMemo, useState } from "react";
import ReelCard from "../components/ReelCard";
import ConfigBanner from "../components/ConfigBanner";
import NicheCombo from "../components/NicheCombo";
import { fmt } from "../components/util";

type Tab = "import" | "gallery" | "trending" | "niches";

const TRAYS = [
  { name: "regular", label: "Regular Posting" },
  { name: "spam", label: "Spam Posting" },
  { name: "pipeline", label: "Content Pipeline" },
];

// tray badge colors
function trayColor(t?: string) {
  if (t === "spam") return "#c0392b";
  if (t === "pipeline") return "#7c4dff";
  return "#2563eb"; // regular = blue
}
function TrayBadge({ tray }: { tray?: string }) {
  if (!tray) return null;
  return (
    <span className="badge" style={{ background: trayColor(tray), color: "#fff" }}>
      {tray}
    </span>
  );
}
function SubCatBadge({ sub }: { sub?: string }) {
  if (!sub) return null;
  return (
    <span className="badge" style={{ background: "var(--panel-2)" }}>
      {sub}
    </span>
  );
}
// AI sub-category confidence — green >0.85, yellow 0.6–0.85, red <0.6.
function ConfBadge({ conf }: { conf?: number | null }) {
  if (conf == null) return null;
  const c = Number(conf);
  const bg = c >= 0.85 ? "#1e7d3b" : c >= 0.6 ? "#b7871f" : "#c0392b";
  return (
    <span className="badge" style={{ background: bg, color: "#fff" }} title="AI sub-category confidence">
      {Math.round(c * 100)}%
    </span>
  );
}

const PAGE_SIZE = 50;

export default function InspirationLibraryPage() {
  const [tab, setTab] = useState<Tab>("import");
  const [niches, setNiches] = useState<string[]>([]);
  const [subCats, setSubCats] = useState<{ name: string; label?: string }[]>([]);

  function loadNiches() {
    fetch("/api/niches")
      .then((r) => r.json())
      .then((j) => setNiches((j.niches || []).map((n: any) => n.name)))
      .catch(() => {});
  }
  function loadSubCats() {
    fetch("/api/inspiration-library")
      .then((r) => r.json())
      .then((j) => setSubCats(j.sub_categories || []))
      .catch(() => {});
  }
  useEffect(() => {
    loadNiches();
    loadSubCats();
  }, []);

  return (
    <div>
      <h1 className="h1">Inspiration Library</h1>
      <p className="sub">
        Bulk-import hundreds of reels &amp; accounts, organize by niche / sub-category / tray, and surface what&rsquo;s trending.
      </p>
      <ConfigBanner />

      <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button className={tab === "import" ? "" : "secondary"} onClick={() => setTab("import")}>📥 Bulk Import</button>
        <button className={tab === "gallery" ? "" : "secondary"} onClick={() => setTab("gallery")}>🖼 Gallery</button>
        <button className={tab === "trending" ? "" : "secondary"} onClick={() => setTab("trending")}>🔥 Trending</button>
        <button className={tab === "niches" ? "" : "secondary"} onClick={() => setTab("niches")}>📊 Niche Dashboard</button>
      </div>

      {tab === "import" && <ImportTab niches={niches} subCats={subCats} onDone={loadNiches} />}
      {tab === "gallery" && <GalleryTab niches={niches} subCats={subCats} onNichesChange={loadNiches} />}
      {tab === "trending" && <TrendingTab />}
      {tab === "niches" && <NicheDashboardTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 1 — Bulk Import
// ─────────────────────────────────────────────────────────────
function ImportTab({
  niches,
  subCats,
  onDone,
}: {
  niches: string[];
  subCats: { name: string; label?: string }[];
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [tray, setTray] = useState("regular");
  const [niche, setNiche] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [format, setFormat] = useState("single");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<any>(null);

  const isSpam = tray === "spam";

  async function runImport() {
    if (!text.trim()) {
      setMsg("Paste some reel links or account handles first.");
      return;
    }
    setBusy(true);
    setResult(null);
    setMsg("Importing… scraping accounts, saving reels & scoring. This can take a while for hundreds of items.");
    try {
      const res = await fetch("/api/inspiration-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          niche: niche.trim() || undefined,
          sub_category: subCategory || undefined,
          tray,
          format: isSpam ? "single" : format,
          import_accounts: true,
          account_count: 25,
        }),
      });
      const j = await res.json();
      if (j.error) {
        setMsg(`Error: ${j.error}`);
      } else {
        setResult(j);
        setMsg("");
        setText("");
        onDone();
      }
    } catch (e: any) {
      setMsg(`Request ended (may still be finishing server-side). Reload in a moment. (${e.message})`);
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h2>Bulk Import</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Paste <b>hundreds</b> of Instagram reel links and/or account handles (no 12-account limit). Accounts bring in their
        top 25 reels each.
      </p>
      <textarea
        placeholder={"Paste reel links and/or account handles (any format, one per line or space-separated)…\n\nhttps://instagram.com/reel/ABC123/\n@tallgirlkimxo\nmarietemara"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        style={{ width: "100%", resize: "vertical", marginBottom: 12 }}
      />

      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Tray</div>
          <select value={tray} onChange={(e) => setTray(e.target.value)} style={{ minWidth: 160 }}>
            {TRAYS.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Niche <span style={{ opacity: 0.7 }}>(pick or type new)</span></div>
          <NicheCombo
            value={niche}
            onChange={setNiche}
            niches={niches}
            onCreate={onDone}
            placeholder="— pick or type new —"
            style={{ minWidth: 190 }}
          />
        </label>

        <label style={{ fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Sub-category</div>
          <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} style={{ minWidth: 170 }}>
            <option value="">— none —</option>
            {subCats.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Format</div>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={isSpam} style={{ minWidth: 150 }}>
            <option value="single">👤 Single-person</option>
            <option value="multi">👥 Multi-person</option>
          </select>
        </label>

        <button onClick={runImport} disabled={busy}>
          {busy ? <><span className="spinner" /> Importing…</> : "📥 Import"}
        </button>
      </div>

      {isSpam && (
        <p className="muted" style={{ marginTop: 12, fontSize: 13, color: "#e08a8a" }}>
          ⚠️ Spam tray reels <b>cannot be multi-person</b> — multi-person videos will be auto-excluded from this import.
        </p>
      )}

      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}

      {result && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="row" style={{ gap: 18, flexWrap: "wrap", fontSize: 14 }}>
            <span>✅ <b>{result.total_reels}</b> reels imported</span>
            <span><b>{result.reels_added}</b> from direct links</span>
            <span><b>{result.accounts_processed}</b> accounts processed</span>
            <span><b>{result.account_reels_added}</b> reels from accounts</span>
            <span>tray: <TrayBadge tray={result.tray} /></span>
            {result.niche && <span>niche: <span className="badge">{result.niche}</span></span>}
          </div>
          {result.failed?.length ? (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              {result.failed.length} failed: {result.failed.map((f: any) => f.handle || f.url).join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 2 — Gallery
// ─────────────────────────────────────────────────────────────
function GalleryTab({
  niches,
  subCats,
  onNichesChange,
}: {
  niches: string[];
  subCats: { name: string; label?: string }[];
  onNichesChange: () => void;
}) {
  const [recs, setRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [fTray, setFTray] = useState("all");
  const [fNiche, setFNiche] = useState("ALL");
  const [fSub, setFSub] = useState("all");
  const [fFormat, setFFormat] = useState("all");
  const [viralOnly, setViralOnly] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("Views");

  // ✨ Auto-categorize
  const [categorizing, setCategorizing] = useState(false);
  const [catMsg, setCatMsg] = useState("");

  // bulk select
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkNiche, setBulkNiche] = useState("");
  const [bulkSub, setBulkSub] = useState("");
  const [bulkTray, setBulkTray] = useState("");
  const [tagging, setTagging] = useState(false);
  const [tagMsg, setTagMsg] = useState("");

  function loadReels() {
    setLoading(true);
    const p = new URLSearchParams({ type: "inspiration", niche: fNiche });
    if (fTray !== "all") p.set("tray", fTray);
    if (fSub !== "all") p.set("sub_category", fSub);
    if (fFormat !== "all") p.set("format", fFormat);
    if (viralOnly) p.set("viral", "true");
    if (needsReview) p.set("needs_review", "true");
    fetch(`/api/reels?${p.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        setRecs(j.records || []);
        setVisible(PAGE_SIZE);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }
  useEffect(loadReels, [fTray, fNiche, fSub, fFormat, viralOnly, needsReview]);

  async function autoCategorize() {
    setCategorizing(true);
    setCatMsg("Categorizing up to 8 reels with Gemini…");
    try {
      const res = await fetch("/api/inspiration-library/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      const j = await res.json();
      if (j.error) setCatMsg(`Error: ${j.error}`);
      else {
        setCatMsg(`✨ Categorized ${j.categorized} · ${j.low_confidence} need review · ${j.failed?.length || 0} failed`);
        loadReels();
      }
    } catch (e: any) {
      setCatMsg(`Request failed: ${e.message}`);
    }
    setCategorizing(false);
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
    const key = sort === "posted_at" ? "Posted At" : sort;
    return [...r].sort((a, b) => {
      if (key === "Posted At") {
        return new Date(b.fields["Posted At"] || 0).getTime() - new Date(a.fields["Posted At"] || 0).getTime();
      }
      return Number(b.fields[key] || 0) - Number(a.fields[key] || 0);
    });
  }, [recs, q, sort]);

  const shown = filtered.slice(0, visible);

  function toggle(url: string) {
    setSelected((s) => ({ ...s, [url]: !s[url] }));
  }
  const selectedUrls = Object.keys(selected).filter((u) => selected[u]);

  async function applyBulkTag() {
    if (!selectedUrls.length) { setTagMsg("Select some reels first."); return; }
    const patch: any = { reel_urls: selectedUrls };
    if (bulkNiche) patch.niche = bulkNiche;
    if (bulkSub) patch.sub_category = bulkSub;
    if (bulkTray) patch.tray = bulkTray;
    if (!bulkNiche && !bulkSub && !bulkTray) { setTagMsg("Pick a niche, sub-category, or tray to apply."); return; }
    setTagging(true);
    setTagMsg("");
    try {
      const res = await fetch("/api/inspiration-library/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (j.error) setTagMsg(`Error: ${j.error}`);
      else {
        setTagMsg(`Tagged ${j.reels_tagged} reel(s).`);
        setSelected({});
        onNichesChange();
        loadReels();
      }
    } catch (e: any) {
      setTagMsg(`Request failed: ${e.message}`);
    }
    setTagging(false);
  }

  async function deleteSelected() {
    if (!selectedUrls.length) { setTagMsg("Select some reels first."); return; }
    if (!confirm(`Delete ${selectedUrls.length} reel(s)? This cannot be undone.`)) return;
    setTagging(true);
    setTagMsg("");
    try {
      const res = await fetch("/api/inspiration-reels/manage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reel_urls: selectedUrls }),
      });
      const j = await res.json();
      if (j.error) setTagMsg(`Error: ${j.error}`);
      else {
        setTagMsg(`Deleted ${j.deleted} reel(s).`);
        setSelected({});
        loadReels();
      }
    } catch (e: any) {
      setTagMsg(`Delete failed: ${e.message}`);
    }
    setTagging(false);
  }

  return (
    <div>
      {/* Filters */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <select value={fTray} onChange={(e) => setFTray(e.target.value)}>
            <option value="all">All trays</option>
            {TRAYS.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
          <select value={fNiche} onChange={(e) => setFNiche(e.target.value)} style={{ minWidth: 150 }}>
            <option value="ALL">All niches</option>
            <option value="UNTAGGED">⚑ Untagged</option>
            {niches.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={fSub} onChange={(e) => setFSub(e.target.value)} style={{ minWidth: 150 }}>
            <option value="all">All sub-categories</option>
            {subCats.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
          </select>
          <select value={fFormat} onChange={(e) => setFFormat(e.target.value)}>
            <option value="all">All formats</option>
            <option value="single">👤 Single-person</option>
            <option value="multi">👥 Multi-person</option>
          </select>
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={viralOnly} onChange={(e) => setViralOnly(e.target.checked)} /> 🔥 Viral only
          </label>
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} /> ⚠️ Needs review
          </label>
          <button className="secondary" onClick={autoCategorize} disabled={categorizing}>
            {categorizing ? <><span className="spinner" /> Categorizing…</> : "✨ Auto-categorize"}
          </button>
          <input placeholder="Search handle, caption…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="Views">Sort: Views</option>
            <option value="Score">Sort: Score</option>
            <option value="Viral Score">Sort: Viral Score</option>
            <option value="posted_at">Sort: Posted</option>
          </select>
          <button className={selectMode ? "" : "secondary"} onClick={() => { setSelectMode((m) => !m); setSelected({}); }}>
            {selectMode ? "✕ Exit select" : "☑ Select"}
          </button>
        </div>

        {selectMode && (
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>{selectedUrls.length} selected →</span>
            <NicheCombo
              value={bulkNiche}
              onChange={setBulkNiche}
              niches={niches}
              onCreate={onNichesChange}
              placeholder="niche… (type new)"
              disabled={tagging}
              style={{ width: 150 }}
            />
            <select value={bulkSub} onChange={(e) => setBulkSub(e.target.value)}>
              <option value="">sub-category…</option>
              {subCats.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
            </select>
            <select value={bulkTray} onChange={(e) => setBulkTray(e.target.value)}>
              <option value="">tray…</option>
              {TRAYS.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
            </select>
            <button onClick={applyBulkTag} disabled={tagging}>
              {tagging ? <><span className="spinner" /> Working…</> : "Apply to selected"}
            </button>
            <button onClick={deleteSelected} disabled={tagging} style={{ background: "#c0392b", color: "#fff" }}>
              🗑 Delete Selected
            </button>
            {tagMsg && <span className="muted" style={{ fontSize: 12 }}>{tagMsg}</span>}
          </div>
        )}
        {catMsg && <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>{catMsg}</p>}
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No reels match these filters.</p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Showing {shown.length} of {filtered.length}
          </p>
          <div className="grid-reels">
            {shown.map((r) => {
              const f = r.fields;
              const url = f["Reel URL"];
              const isSel = !!selected[url];
              return (
                <div key={r.id} style={{ position: "relative" }}>
                  {selectMode && (
                    <label
                      style={{
                        position: "absolute", top: 8, left: 8, zIndex: 5,
                        background: "rgba(0,0,0,.6)", borderRadius: 6, padding: "4px 6px", cursor: "pointer",
                      }}
                    >
                      <input type="checkbox" checked={isSel} onChange={() => toggle(url)} />
                    </label>
                  )}
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    <TrayBadge tray={f["Tray"]} />
                    <SubCatBadge sub={f["Sub Category"]} />
                    <ConfBadge conf={f["Sub Category Confidence"]} />
                    {f["Is Viral"] && (
                      <span className="badge" style={{ background: "#c0392b", color: "#fff" }}>
                        🔥 viral{f["Viral Score"] != null ? ` ${Math.round(Number(f["Viral Score"]))}` : ""}
                      </span>
                    )}
                  </div>
                  <ReelCard rec={r} />
                </div>
              );
            })}
          </div>
          {visible < filtered.length && (
            <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
              <button className="secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Load more ({filtered.length - visible} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 3 — Trending
// ─────────────────────────────────────────────────────────────
function TrendingTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(168);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState("");

  function loadTrends() {
    setLoading(true);
    fetch(`/api/inspiration-library/trending?hours=${hours}`)
      .then((r) => r.json())
      .then((j) => { setData(j); setLoading(false); })
      .catch(() => setLoading(false));
  }
  useEffect(loadTrends, [hours]);

  async function recalcViral() {
    setRecalcing(true);
    setRecalcMsg("Recalculating virality (views/hr, viral score)…");
    try {
      const res = await fetch("/api/inspiration-library/calc-viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 300 }),
      });
      const j = await res.json();
      if (j.error) setRecalcMsg(`Error: ${j.error}`);
      else {
        setRecalcMsg(`🔄 Checked ${j.checked} · ${j.viral_found} viral`);
        loadTrends();
      }
    } catch (e: any) {
      setRecalcMsg(`Request failed: ${e.message}`);
    }
    setRecalcing(false);
  }

  const windows = [
    { h: 24, label: "24h" },
    { h: 168, label: "7 days" },
    { h: 720, label: "30 days" },
  ];

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {windows.map((w) => (
          <button key={w.h} className={hours === w.h ? "" : "secondary"} onClick={() => setHours(w.h)}>{w.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={recalcViral} disabled={recalcing}>
          {recalcing ? <><span className="spinner" /> Recalculating…</> : "🔄 Recalculate virality"}
        </button>
        {recalcMsg && <span className="muted" style={{ fontSize: 12 }}>{recalcMsg}</span>}
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading trends…</p>
      ) : !data ? (
        <p className="muted">No trend data.</p>
      ) : (
        <>
          <section className="panel" style={{ marginBottom: 16 }}>
            <h2>🔥 Fresh Viral <span className="muted" style={{ fontSize: 13 }}>(viral, posted in last 24h)</span></h2>
            {data.fresh_viral?.length ? (
              <div className="grid-reels">
                {data.fresh_viral.map((r: any) => <ReelCard key={r.id || r.reel_url} rec={rowToRec(r)} />)}
              </div>
            ) : (
              <p className="muted">Nothing fresh &amp; viral in the last 24h.</p>
            )}
          </section>

          <TrendTable
            title="📈 Rising Niches"
            rows={data.rising_niches}
            cols={["Niche", "Reels", "Avg views", "Viral", "Viral rate"]}
            render={(n: any) => [n.name, n.count, fmt(n.avg_views), n.viral_count, `${n.viral_rate}%`]}
          />

          <TrendTable
            title="🎯 Rising Sub-Categories"
            rows={data.rising_sub_categories}
            cols={["Sub-category", "Reels", "Avg views", "Viral", "Viral rate"]}
            render={(n: any) => [n.name, n.count, fmt(n.avg_views), n.viral_count, `${n.viral_rate}%`]}
          />

          <TrendTable
            title="⚠️ Underperforming Niches"
            subtitle="avg score below 4 — consider dropping"
            rows={data.underperforming_niches}
            cols={["Niche", "Reels", "Avg views", "Avg score"]}
            render={(n: any) => [n.name, n.count, fmt(n.avg_views), n.avg_score]}
            empty="No underperformers 🎉"
          />

          <TrendTable
            title="💡 Top Opportunities"
            subtitle="high score, still emerging (low volume)"
            rows={data.opportunities}
            cols={["Niche", "Reels", "Avg views", "Avg score", "Viral rate"]}
            render={(n: any) => [n.name, n.count, fmt(n.avg_views), n.avg_score, `${n.viral_rate}%`]}
            empty="No standout opportunities yet."
          />
        </>
      )}
    </div>
  );
}

function TrendTable({
  title,
  subtitle,
  rows,
  cols,
  render,
  empty,
}: {
  title: string;
  subtitle?: string;
  rows: any[];
  cols: string[];
  render: (r: any) => (string | number)[];
  empty?: string;
}) {
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <h2>{title}</h2>
      {subtitle && <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>{subtitle}</p>}
      {rows?.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const cells = render(r);
              return (
                <tr key={ri}>
                  {cells.map((cell, ci) => (
                    <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{cell}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">{empty || "No data for this window."}</p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 4 — Niche Dashboard
// ─────────────────────────────────────────────────────────────
function NicheDashboardTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/inspiration-library/tag")
      .then((r) => r.json())
      .then((j) => { setData(j); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const ns = (data?.niche_stats || []).map((n: any) => ({
      ...n,
      viral_rate: n.count ? Math.round((n.viral / n.count) * 100) : 0,
    }));
    return [...ns].sort((a, b) => b.views - a.views);
  }, [data]);

  if (loading) return <p className="muted"><span className="spinner" /> Loading niche stats…</p>;
  if (!data) return <p className="muted">No stats available.</p>;

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 24, flexWrap: "wrap", fontSize: 15 }}>
          <span><b>{fmt(data.total)}</b> reels</span>
          <span><b>{fmt(data.viral)}</b> viral</span>
          <span><b>{fmt(data.total_views)}</b> total views</span>
          <span>avg score <b>{data.avg_score}</b></span>
        </div>
      </div>

      <section className="panel">
        <h2>📊 Per-Niche Breakdown</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>Sorted by total views — where to focus vs. drop.</p>
        {rows.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Niche", "Reels", "Total views", "Avg score", "Viral", "Viral rate"].map((c, i) => (
                  <th key={c} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((n: any) => (
                <tr key={n.name}>
                  <td style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{n.name}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{fmt(n.count)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{fmt(n.views)}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{Math.round((n.avg_score || 0) * 10) / 10}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{n.viral}</td>
                  <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>{n.viral_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No niche data yet — import some reels first.</p>
        )}
      </section>
    </div>
  );
}

// Trending endpoint returns raw DB rows; map to the { fields } shape ReelCard expects.
function rowToRec(r: any) {
  return {
    id: r.id,
    fields: {
      "Reel URL": r.reel_url,
      "Author Handle": r.author_handle,
      Caption: r.caption,
      Views: Number(r.views || 0),
      Likes: Number(r.likes || 0),
      Comments: Number(r.comments || 0),
      "Engagement Rate": Number(r.engagement_rate || 0),
      "View/Follow Ratio": Number(r.view_follow_ratio || 0),
      Thumbnail: r.thumbnail_url ? [{ url: r.thumbnail_url }] : undefined,
      Niche: r.niche,
      Score: r.inspiration_score != null ? Number(r.inspiration_score) : null,
      Format: r.format || null,
      "Sub Category": r.sub_category,
      "Tray": r.tray,
      "Is Viral": r.is_viral,
      "Viral Score": r.viral_score != null ? Number(r.viral_score) : null,
    },
  };
}
