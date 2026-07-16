"use client";
import { useEffect, useMemo, useState } from "react";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

export default function CommentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [accts, setAccts] = useState<any[]>([]);
  const [scope, setScope] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/comments").then((r) => r.json()).then((j) => {
      setRows(j.rows || []);
      setLoading(false);
    });
  }
  useEffect(() => {
    fetch("/api/accounts?type=our").then((r) => r.json()).then((j) => setAccts(j.records || []));
    load();
  }, []);

  const handles = useMemo(
    () => accts.map((a) => String(a.fields.Handle || "")).filter(Boolean),
    [accts]
  );

  const filtered = useMemo(
    () => (scope === "ALL" ? rows : rows.filter((r) => String(r.account_handle || "").toLowerCase() === scope.toLowerCase())),
    [rows, scope]
  );

  const agg = useMemo(() => {
    const analyzed = filtered.reduce((s, r) => s + Number(r.comments_analyzed || 0), 0);
    const ai = filtered.reduce((s, r) => s + Number(r.ai_count || 0), 0);
    const pos = filtered.reduce((s, r) => s + Number(r.pos_count || 0), 0);
    const neg = filtered.reduce((s, r) => s + Number(r.neg_count || 0), 0);
    const tells: Record<string, number> = {};
    for (const r of filtered)
      for (const [k, v] of Object.entries(r.tells || {})) tells[k] = (tells[k] || 0) + Number(v);
    const topTells = Object.entries(tells).sort((a, b) => b[1] - a[1]);
    return {
      analyzed,
      reels: filtered.length,
      aiPct: analyzed ? Math.round((ai / analyzed) * 1000) / 10 : 0,
      posPct: analyzed ? Math.round((pos / analyzed) * 100) : 0,
      negPct: analyzed ? Math.round((neg / analyzed) * 100) : 0,
      topTells,
    };
  }, [filtered]);

  async function analyze() {
    setBusy(true);
    setMsg("Scraping & analyzing comments… this can take a few minutes for a full account. You can leave and come back.");
    try {
      const res = await fetch("/api/analyze-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: scope, reelLimit: 40, pages: 10 }),
      });
      const j = await res.json();
      setMsg(j.error ? `Error: ${j.error}` : `Done — analyzed ${j.summary?.analyzed}/${j.summary?.reels} reels.`);
      load();
    } catch (e: any) {
      setMsg(`Request ended (the job may still be finishing server-side). Reload in a minute. (${e.message})`);
    }
    setBusy(false);
  }

  const sorted = [...filtered].sort((a, b) => Number(b.ai_pct || 0) - Number(a.ai_pct || 0));

  return (
    <div>
      <h1 className="h1">Comment Intelligence</h1>
      <p className="sub">AI-accusation rate, sentiment, and the specific "tells" viewers cite — per reel.</p>
      <ConfigBanner />

      <div className="row" style={{ marginBottom: 16 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ minWidth: 200 }}>
          <option value="ALL">All accounts</option>
          {handles.map((h) => <option key={h} value={h}>@{h}</option>)}
        </select>
        <button onClick={analyze} disabled={busy}>
          {busy ? <><span className="spinner" /> Analyzing…</> : `↻ Analyze comments${scope !== "ALL" ? ` for @${scope}` : ""}`}
        </button>
      </div>
      {msg && <p className="muted" style={{ marginBottom: 14 }}>{msg}</p>}

      <div className="cards">
        <div className="card"><div className="k">AI-accusation rate</div><div className="v">{agg.aiPct}%</div></div>
        <div className="card"><div className="k">Comments analyzed</div><div className="v">{fmt(agg.analyzed)}</div></div>
        <div className="card"><div className="k">Positive</div><div className="v">{agg.posPct}%</div></div>
        <div className="card"><div className="k">Negative</div><div className="v">{agg.negPct}%</div></div>
      </div>

      {agg.topTells.length > 0 && (
        <div className="panel">
          <h2>Why they say it's AI (top cited tells)</h2>
          <table>
            <tbody>
              {agg.topTells.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td style={{ textAlign: "right", color: "var(--accent)" }}>{v} mentions</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2>Per-reel breakdown (worst AI% first)</h2>
        {loading ? (
          <p className="muted"><span className="spinner" /> Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="muted">No comment data yet. Pick an account and hit <b>Analyze comments</b>.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Account</th><th>Caption</th><th>Analyzed</th><th>AI%</th><th>Neg</th><th>Top tell</th><th></th></tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const topTell = Object.entries(r.tells || {}).sort((a: any, b: any) => b[1] - a[1])[0];
                const isOpen = open === r.reel_url;
                return (
                  <>
                    <tr key={r.reel_url} onClick={() => setOpen(isOpen ? null : r.reel_url)} style={{ cursor: "pointer" }}>
                      <td>@{r.account_handle}</td>
                      <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.caption || ""}</td>
                      <td>{r.comments_analyzed}</td>
                      <td style={{ color: Number(r.ai_pct) >= 10 ? "var(--accent)" : "var(--text)", fontWeight: 600 }}>{r.ai_pct}%</td>
                      <td>{r.neg_count}</td>
                      <td className="muted">{topTell ? `${topTell[0]} (${topTell[1]})` : "—"}</td>
                      <td><a href={r.reel_url} target="_blank" rel="noreferrer" className="badge" onClick={(e) => e.stopPropagation()}>open</a></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--panel-2)" }}>
                          <div style={{ padding: "6px 4px" }}>
                            {(r.sample_ai || []).length > 0 && (
                              <>
                                <div className="k" style={{ color: "var(--muted)", marginBottom: 6 }}>Sample AI comments</div>
                                <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13 }}>
                                  {(r.sample_ai || []).map((c: string, i: number) => <li key={i}>{c}</li>)}
                                </ul>
                              </>
                            )}
                            {(r.sample_neg || []).length > 0 && (
                              <>
                                <div className="k" style={{ color: "var(--muted)", marginBottom: 6 }}>Sample negative</div>
                                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                  {(r.sample_neg || []).map((c: string, i: number) => <li key={i}>{c}</li>)}
                                </ul>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
