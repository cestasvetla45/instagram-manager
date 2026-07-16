"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import ConfigBanner from "../components/ConfigBanner";
import ReelCard from "../components/ReelCard";
import { fmt } from "../components/util";

// ─────────────────────────────────────────────────────────────
//  Reel Performance dashboard (Task 5c).
//  3 tabs: Performance Tracker · Winner Templates · Trends.
//  Reads the /api/reel-performance* endpoints built in 5a/5b.
// ─────────────────────────────────────────────────────────────

type Tab = "tracker" | "winners" | "trends";

// AI score colour band — green >7, yellow 4-7, red <4.
function aiScoreColor(score: number | null | undefined): string {
  const s = Number(score || 0);
  if (s > 7) return "#16a34a";
  if (s >= 4) return "#eab308";
  return "#ef4444";
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null || isNaN(Number(score))) return <span className="muted">—</span>;
  return (
    <span
      className="badge"
      style={{ background: aiScoreColor(score), color: "#0b0b12", fontWeight: 800 }}
      title="AI performance score (0–10)"
    >
      {Number(score).toFixed(1)}
    </span>
  );
}

function pctFmt(v: any): string {
  if (v == null || isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(0)}%`;
}

function dateFmt(v: any): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Curve-shape → coloured badge.
function CurveBadge({ curve }: { curve?: string | null }) {
  if (!curve) return null;
  const map: Record<string, string> = {
    "U-shape": "#6366f1",
    declining: "#ef4444",
    "spike-end": "#16a34a",
    flat: "#64748b",
  };
  return (
    <span className="badge" style={{ background: map[curve] || "var(--panel-2)", color: "#fff" }}>
      {curve}
    </span>
  );
}

// ── Inline SVG retention bar chart ────────────────────────────
// Each bar = a second, height ∝ retention %. Green bars.
function RetentionGraph({ graph }: { graph: any }) {
  const pts = (Array.isArray(graph) ? graph : [])
    .map((p: any) => ({ second: Number(p?.second), retention: Number(p?.retention) }))
    .filter((p: any) => Number.isFinite(p.second) && Number.isFinite(p.retention))
    .sort((a: any, b: any) => a.second - b.second);
  if (!pts.length) return <div className="muted" style={{ fontSize: 12 }}>No retention data (screenshots not analyzed).</div>;

  const W = 480;
  const H = 120;
  const pad = 20;
  const n = pts.length;
  const barW = Math.max(2, (W - pad * 2) / n - 2);
  const maxR = 100;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block" }} role="img" aria-label="Retention graph">
      {/* baseline */}
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--border)" strokeWidth={1} />
      {pts.map((p: any, i: number) => {
        const h = Math.max(1, ((Math.min(maxR, Math.max(0, p.retention)) / maxR) * (H - pad * 2)));
        const x = pad + i * ((W - pad * 2) / n) + 1;
        const y = H - pad - h;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} rx={1} fill="#16a34a">
            <title>{`${p.second}s — ${Math.round(p.retention)}%`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// ── Detail panel (expanded row) ───────────────────────────────
function DetailPanel({ rec }: { rec: any }) {
  const demo = rec.demographics || {};
  const age: Record<string, number> = demo.age || {};
  const gender: Record<string, number> = demo.gender || {};
  const countries: string[] = demo.top_countries || rec.top_territories || [];
  const shots: string[] = Array.isArray(rec.screenshot_urls) ? rec.screenshot_urls.filter(Boolean) : [];

  return (
    <div className="panel" style={{ margin: "0 0 8px", background: "var(--panel-2)" }}>
      <div className="grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div>
          <h4 style={{ margin: "0 0 6px" }}>AI Feedback</h4>
          <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>
            {rec.ai_feedback || <span className="muted">Not analyzed yet.</span>}
          </p>

          {(rec.ai_strengths?.length || rec.ai_weaknesses?.length) ? (
            <div className="row" style={{ gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Strengths</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {(rec.ai_strengths || []).map((s: string, i: number) => (
                    <span key={i} className="badge" style={{ background: "#16a34a", color: "#fff" }}>✅ {s}</span>
                  ))}
                  {!rec.ai_strengths?.length && <span className="muted">—</span>}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Weaknesses</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {(rec.ai_weaknesses || []).map((w: string, i: number) => (
                    <span key={i} className="badge" style={{ background: "#ef4444", color: "#fff" }}>⚠️ {w}</span>
                  ))}
                  {!rec.ai_weaknesses?.length && <span className="muted">—</span>}
                </div>
              </div>
            </div>
          ) : null}

          <h4 style={{ margin: "8px 0 6px" }}>Retention curve <CurveBadge curve={rec.retention_curve} /></h4>
          <RetentionGraph graph={rec.retention_graph} />
        </div>

        <div>
          <h4 style={{ margin: "0 0 6px" }}>Demographics</h4>
          {Object.keys(age).length ? (
            <div style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12 }}>Age</div>
              {Object.entries(age).map(([k, v]) => (
                <div key={k} style={{ fontSize: 13 }}>{k}: <b>{Number(v)}%</b></div>
              ))}
            </div>
          ) : null}
          {Object.keys(gender).length ? (
            <div style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12 }}>Gender</div>
              {Object.entries(gender).map(([k, v]) => (
                <div key={k} style={{ fontSize: 13 }}>{k}: <b>{Number(v)}%</b></div>
              ))}
            </div>
          ) : null}
          {countries.length ? (
            <div style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 12 }}>Top countries</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {countries.map((c, i) => <span key={i} className="badge">{c}</span>)}
              </div>
            </div>
          ) : null}
          {!Object.keys(age).length && !Object.keys(gender).length && !countries.length && (
            <div className="muted" style={{ fontSize: 13 }}>No demographic data.</div>
          )}

          {rec.inspiration_reel_url && (
            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12 }}>Modeled on</div>
              <a href={rec.inspiration_reel_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                Inspiration reel ↗
              </a>
            </div>
          )}
        </div>
      </div>

      {shots.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Screenshots</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {shots.map((s, i) => (
              <a key={i} href={s} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s} alt={`screenshot ${i + 1}`} style={{ height: 120, borderRadius: 8, border: "1px solid var(--border)" }} loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Tab 1: Performance Tracker ────────────────────────────────
function TrackerTab() {
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState(20);

  // filters
  const [account, setAccount] = useState("");
  const [winnersOnly, setWinnersOnly] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  async function load() {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (account) p.set("account_handle", account);
      if (winnersOnly) p.set("winners_only", "1");
      if (since) p.set("since", since);
      if (until) p.set("until", until);
      p.set("limit", "200");
      const j = await fetch(`/api/reel-performance?${p.toString()}`).then((r) => r.json());
      setRecords(j.records || []);
      setStats(j.stats || null);
      setVisible(20);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, winnersOnly, since, until]);

  const accounts = useMemo(
    () => Array.from(new Set(records.map((r) => r.account_handle).filter(Boolean))).sort(),
    [records]
  );

  async function analyzeNow() {
    setAnalyzing(true);
    setMsg("");
    try {
      const j = await fetch("/api/reel-performance/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setMsg(`Analyzed ${j.analyzed || 0} reel(s), ${j.winners || 0} winner(s).${j.failed?.length ? ` ${j.failed.length} failed.` : ""}`);
      await load();
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      {stats && (
        <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>Tracked</div><b style={{ fontSize: 20 }}>{stats.total}</b></div>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>Analyzed</div><b style={{ fontSize: 20 }}>{stats.analyzed}</b></div>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>Pending</div><b style={{ fontSize: 20 }}>{stats.pending}</b></div>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>🏆 Winners</div><b style={{ fontSize: 20 }}>{stats.winners}</b></div>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>Avg score</div><b style={{ fontSize: 20 }}>{stats.avg_score}</b></div>
          <div className="panel" style={{ padding: "10px 14px" }}><div className="muted" style={{ fontSize: 12 }}>Avg retention</div><b style={{ fontSize: 20 }}>{stats.avg_retention}%</b></div>
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={account} onChange={(e) => setAccount(e.target.value)} style={{ fontSize: 13 }}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a} value={a}>@{a}</option>)}
        </select>
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={winnersOnly} onChange={(e) => setWinnersOnly(e.target.checked)} />
          🏆 Winners only
        </label>
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          From <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          To <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ fontSize: 13 }} />
        </label>
        <button onClick={analyzeNow} disabled={analyzing}>
          {analyzing ? <><span className="spinner" /> Analyzing…</> : "⚡ Analyze now"}
        </button>
      </div>

      {msg && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{msg}</div>}

      {loading ? (
        <div className="row" style={{ gap: 8, alignItems: "center" }}><span className="spinner" /> Loading…</div>
      ) : !records.length ? (
        <div className="muted">No reel performance records yet.</div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "var(--panel-2)" }}>
                <th style={{ padding: "8px 10px" }}>Account</th>
                <th style={{ padding: "8px 10px" }}>Posted</th>
                <th style={{ padding: "8px 10px" }}>Views 24h</th>
                <th style={{ padding: "8px 10px" }}>Retention</th>
                <th style={{ padding: "8px 10px" }}>Skip</th>
                <th style={{ padding: "8px 10px" }}>Score</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
                <th style={{ padding: "8px 10px" }}></th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, visible).map((r) => {
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : r.id)}
                      style={{ cursor: "pointer", borderTop: "1px solid var(--border)", background: open ? "var(--panel-2)" : undefined }}
                    >
                      <td style={{ padding: "8px 10px" }}>@{r.account_handle}</td>
                      <td style={{ padding: "8px 10px" }}>{dateFmt(r.posted_at)}</td>
                      <td style={{ padding: "8px 10px" }}>{fmt(r.views_24h)}</td>
                      <td style={{ padding: "8px 10px" }}>{pctFmt(r.avg_retention)}</td>
                      <td style={{ padding: "8px 10px" }}>{pctFmt(r.skip_rate)}</td>
                      <td style={{ padding: "8px 10px" }}><ScoreBadge score={r.ai_score} /></td>
                      <td style={{ padding: "8px 10px" }}>
                        <span className="badge" style={{ background: "var(--panel-2)" }}>{r.status || "posted"}</span>
                        {r.is_winner ? <span title="Winner" style={{ marginLeft: 6, color: "#f5b301" }}>🏆</span> : null}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--muted)" }}>{open ? "▲" : "▼"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} style={{ padding: "6px 10px" }}>
                          <DetailPanel rec={r} />
                          {r.reel_url && (
                            <a href={r.reel_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Open reel ↗</a>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {visible < records.length && (
            <div className="row" style={{ justifyContent: "center", padding: 14 }}>
              <button className="secondary" onClick={() => setVisible((v) => v + 20)}>
                Load more ({records.length - visible} left)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Map a raw inspiration_reels row → the Airtable-style shape ReelCard wants.
function inspToRec(r: any) {
  return {
    id: r.reel_url,
    fields: {
      "Reel URL": r.reel_url,
      "Author Handle": r.author_handle,
      Caption: r.caption,
      Views: Number(r.views || 0),
      Thumbnail: r.thumbnail_url ? [{ url: r.thumbnail_url }] : undefined,
      Niche: r.niche,
      "Content Type": r.content_type || "reel",
      "Sub Category": r.sub_category,
      Score: r.viral_score != null ? Number(r.viral_score) : null,
    },
  };
}

// ── Tab 2: Winner Templates ───────────────────────────────────
function WinnersTab() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const j = await fetch("/api/reel-performance/winners").then((r) => r.json());
      setTemplates(j.winner_templates || []);
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function generate(templateId: string) {
    setGenBusy(templateId);
    setMsg("");
    try {
      const j = await fetch("/api/reel-performance/winners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setSuggestions((prev) => ({ ...prev, [templateId]: j.suggestions || [] }));
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setGenBusy(null);
    }
  }

  if (loading) return <div className="row" style={{ gap: 8, alignItems: "center" }}><span className="spinner" /> Loading…</div>;
  if (!templates.length) return <div className="muted">No winner templates yet — they emerge once enough analyzed reels share a winning pattern.</div>;

  return (
    <div>
      {msg && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {templates.map((t) => {
          const open = openId === t.id;
          return (
            <div key={t.id} className="panel" style={{ cursor: "pointer", border: open ? "1px solid var(--accent)" : undefined }}>
              <div onClick={() => setOpenId(open ? null : t.id)}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🏆 {t.name}</div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{t.description}</div>
                <div className="row" style={{ gap: 12, flexWrap: "wrap", fontSize: 13 }}>
                  <span><b>{Number(t.avg_retention || 0).toFixed(0)}%</b> retention</span>
                  <span><b>{fmt(t.avg_views)}</b> avg views</span>
                  <span><b>{t.instance_count || t.instances?.length || 0}</b> instances</span>
                </div>
                <div style={{ marginTop: 8 }}><CurveBadge curve={t.retention_curve} /></div>
              </div>

              {open && (
                <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }} onClick={(e) => e.stopPropagation()}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Matching reels</div>
                  {(t.instances || []).length ? (
                    (t.instances || []).map((r: any, i: number) => (
                      <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                        @{r.account_handle} — {pctFmt(r.avg_retention)} · <ScoreBadge score={r.ai_score} />
                        {r.reel_url && <> · <a href={r.reel_url} target="_blank" rel="noreferrer">open ↗</a></>}
                      </div>
                    ))
                  ) : <div className="muted" style={{ fontSize: 13 }}>—</div>}

                  <button onClick={() => generate(t.id)} disabled={genBusy === t.id} style={{ marginTop: 10 }}>
                    {genBusy === t.id ? <><span className="spinner" /> Generating…</> : "✨ Generate inspiration"}
                  </button>

                  {suggestions[t.id] && (
                    <div style={{ marginTop: 12 }}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                        {suggestions[t.id].length} suggested inspiration reel(s)
                      </div>
                      {suggestions[t.id].length ? (
                        <div className="grid-reels">
                          {suggestions[t.id].map((s: any, i: number) => <ReelCard key={i} rec={inspToRec(s)} />)}
                        </div>
                      ) : <div className="muted" style={{ fontSize: 13 }}>No fresh unused reels match this pattern.</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab 3: Trends ─────────────────────────────────────────────
function TrendsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/reel-performance/trends")
      .then((r) => r.json())
      .then((j) => { if (j.error) setMsg(j.error); else setData(j); })
      .catch((e) => setMsg(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="row" style={{ gap: 8, alignItems: "center" }}><span className="spinner" /> Analyzing trends…</div>;
  if (msg) return <div className="muted">{msg}</div>;

  const summaries: any[] = data?.trend_summaries || [];
  if (!summaries.length) return <div className="muted">Not enough analyzed reels to surface trends yet.</div>;

  const byScore = [...summaries].sort((a, b) => Number(b.avg_ai_score || 0) - Number(a.avg_ai_score || 0));
  const working = byScore.slice(0, 5);
  const notWorking = [...byScore].reverse().slice(0, 5);

  // Retention-curve distribution across all patterns.
  const curveCounts: Record<string, number> = {};
  for (const s of summaries) {
    const c = s.retention_curve || "flat";
    curveCounts[c] = (curveCounts[c] || 0) + 1;
  }
  const maxCurve = Math.max(1, ...Object.values(curveCounts));

  // Avg retention by sub_category.
  const bySub = [...summaries]
    .filter((s) => s.sub_category)
    .sort((a, b) => Number(b.avg_retention || 0) - Number(a.avg_retention || 0));

  return (
    <div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Based on {data?.total_analyzed || 0} analyzed reel(s) across {summaries.length} pattern group(s).
      </div>

      <div className="grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>✅ What&rsquo;s working</h3>
          {working.map((s, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : undefined }}>
              <div style={{ fontWeight: 600 }}>{s.label || s.sub_category || "General"} {s.is_winner_pattern ? "🏆" : ""}</div>
              <div className="row" style={{ gap: 12, fontSize: 13, marginTop: 2 }}>
                <span><b>{Number(s.avg_retention || 0).toFixed(0)}%</b> retention</span>
                <span>score <ScoreBadge score={s.avg_ai_score} /></span>
                <span className="muted">{s.instance_count} reels</span>
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>⚠️ What&rsquo;s not working</h3>
          {notWorking.map((s, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : undefined }}>
              <div style={{ fontWeight: 600 }}>{s.label || s.sub_category || "General"}</div>
              <div className="row" style={{ gap: 12, fontSize: 13, marginTop: 2 }}>
                <span><b>{Number(s.avg_retention || 0).toFixed(0)}%</b> retention</span>
                <span>score <ScoreBadge score={s.avg_ai_score} /></span>
                <span className="muted">{s.avg_skip_rate != null ? `${Number(s.avg_skip_rate).toFixed(0)}% skip` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Retention curve distribution</h3>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", height: 140, padding: "10px 0" }}>
          {Object.entries(curveCounts).map(([curve, count]) => (
            <div key={curve} style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{count}</div>
              <div style={{ background: "#16a34a", height: `${(count / maxCurve) * 100}px`, borderRadius: 4, minHeight: 4 }} />
              <div style={{ marginTop: 6 }}><CurveBadge curve={curve} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Avg retention by sub-category</h3>
        {bySub.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Sub-category</th>
                <th style={{ padding: "6px 8px" }}>Avg retention</th>
                <th style={{ padding: "6px 8px" }}>Avg score</th>
                <th style={{ padding: "6px 8px" }}>Reels</th>
                <th style={{ padding: "6px 8px" }}>Curve</th>
              </tr>
            </thead>
            <tbody>
              {bySub.map((s, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px" }}>{s.sub_category}</td>
                  <td style={{ padding: "6px 8px" }}>{Number(s.avg_retention || 0).toFixed(0)}%</td>
                  <td style={{ padding: "6px 8px" }}><ScoreBadge score={s.avg_ai_score} /></td>
                  <td style={{ padding: "6px 8px" }}>{s.instance_count}</td>
                  <td style={{ padding: "6px 8px" }}><CurveBadge curve={s.retention_curve} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="muted" style={{ fontSize: 13 }}>No sub-category data.</div>}
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const [tab, setTab] = useState<Tab>("tracker");

  return (
    <div>
      <h1 className="h1">Reel Performance</h1>
      <p className="sub">
        Track how our posted reels performed, distil winning patterns, and see what&rsquo;s working across accounts.
      </p>
      <ConfigBanner />

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <button className={tab === "tracker" ? "" : "secondary"} onClick={() => setTab("tracker")}>📊 Performance Tracker</button>
        <button className={tab === "winners" ? "" : "secondary"} onClick={() => setTab("winners")}>🏆 Winner Templates</button>
        <button className={tab === "trends" ? "" : "secondary"} onClick={() => setTab("trends")}>📈 Trends</button>
      </div>

      {tab === "tracker" && <TrackerTab />}
      {tab === "winners" && <WinnersTab />}
      {tab === "trends" && <TrendsTab />}
    </div>
  );
}
