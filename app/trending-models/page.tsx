"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function fmt(n: number | undefined | null): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1) + "K";
  return String(v);
}

const SORTS: { key: string; label: string }[] = [
  { key: "total_views", label: "Total views" },
  { key: "viral_reel_count", label: "Viral count" },
  { key: "viral_rate", label: "Viral rate" },
  { key: "avg_viral_score", label: "Avg score" },
];

export default function TrendingModels() {
  const router = useRouter();
  const [models, setModels] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [niche, setNiche] = useState("");
  const [nichesList, setNichesList] = useState<string[]>([]);
  const [windowDays, setWindowDays] = useState(7);
  const [sort, setSort] = useState("total_views");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/niches").then((r) => r.json()).then((j) => setNichesList((j.niches || []).map((n: any) => n.name)));
  }, []);

  function load(nicheVal: string, windowVal: number) {
    setLoading(true);
    fetch(`/api/trending-models?window=${windowVal}&niche=${encodeURIComponent(nicheVal)}&limit=50`)
      .then((r) => r.json())
      .then((j) => {
        setModels(j.models || []);
        setSummary(j.summary || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load(niche, windowDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  function onNicheChange(v: string) {
    setNiche(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(v, windowDays), 400);
  }

  const sorted = useMemo(() => {
    return [...models].sort((a, b) => Number(b[sort] || 0) - Number(a[sort] || 0));
  }, [models, sort]);

  return (
    <div>
      <h1 className="h1">🔥 Trending Models</h1>
      <p className="sub">Most viral creators right now — study and replicate with your own spin</p>

      {summary && (
        <div className="panel">
          <div className="row">
            <span className="badge">{summary.total_models} models shown</span>
            <span className="badge">🔥 {summary.total_viral_reels} viral reels</span>
            <span className="badge">👁 {fmt(summary.total_views)} total views</span>
            {summary.hottest_niche && <span className="badge">🌶 hottest: {summary.hottest_niche}</span>}
            {summary.fastest_rising && <span className="badge">📈 fastest rising: {summary.fastest_rising}</span>}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="row" style={{ alignItems: "flex-end", gap: 18 }}>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Niche</div>
            <input
              list="niche-list"
              value={niche}
              onChange={(e) => onNicheChange(e.target.value)}
              onBlur={() => load(niche, windowDays)}
              onKeyDown={(e) => { if (e.key === "Enter") load(niche, windowDays); }}
              placeholder="All niches"
              style={{ minWidth: 200 }}
            />
            <datalist id="niche-list">
              {nichesList.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Window</div>
            <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              <option value={1}>24h</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <div>
            <div className="k" style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Sort by</div>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {loading && <span className="spinner" />}
        </div>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading trending models…</p>
      ) : sorted.length === 0 ? (
        <p className="muted">No viral models found yet. The system needs more time to detect trending content.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {sorted.map((m) => (
            <div key={m.handle} className="panel" style={{ marginBottom: 0 }}>
              <div className="row" style={{ alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
                {m.profile_pic ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.profile_pic} alt={m.handle} width={44} height={44} style={{ borderRadius: "50%", objectFit: "cover", width: 44, height: 44, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>
                    {(m.handle || "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <a href={`https://www.instagram.com/${m.handle}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                    @{m.handle}
                  </a>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.full_name ? `${m.full_name} · ` : ""}{m.followers != null ? `${fmt(m.followers)} followers` : ""}
                  </div>
                </div>
              </div>

              {m.niche && <div style={{ marginTop: 10 }}><span className="badge">{m.niche}</span></div>}

              <div className="muted" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
                🔥 {m.viral_reel_count} viral reels · 👁 {fmt(m.total_views)} total views · 📈 {m.viral_rate}% viral rate · ⭐ avg score {m.avg_viral_score ?? "—"}
              </div>

              {m.top_reels && m.top_reels.length > 0 && (
                <>
                  <div className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Top reels:</div>
                  <div className="row" style={{ gap: 8 }}>
                    {m.top_reels.map((r: any, i: number) => (
                      <a key={i} href={r.reel_url} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center" }}>
                        {r.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumbnail_url} alt="" style={{ width: 90, height: 120, objectFit: "cover", borderRadius: 8 }} />
                        ) : (
                          <div style={{ width: 90, height: 120, borderRadius: 8, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                            🎬
                          </div>
                        )}
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{fmt(r.views)}</div>
                      </a>
                    ))}
                  </div>
                </>
              )}

              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <a href={`https://www.instagram.com/${m.handle}/`} target="_blank" rel="noreferrer">
                  <button className="secondary">View on IG</button>
                </a>
                <button onClick={() => router.push(`/generate?niche=${encodeURIComponent(m.niche || "")}`)}>
                  Copy Concept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
