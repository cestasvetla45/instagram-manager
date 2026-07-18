"use client";
import { useEffect, useMemo, useState } from "react";
import ReelCard from "../components/ReelCard";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

export default function TopReels() {
  const [reels, setReels] = useState<any[]>([]);
  const [accts, setAccts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(5);

  useEffect(() => {
    Promise.all([
      // limit=500 covers all "our" reels (well under the API's max) so per-account
      // totals aren't silently undercounted by the default 200-row API limit.
      fetch("/api/reels?type=our&limit=500").then((r) => r.json()),
      fetch("/api/accounts?type=our").then((r) => r.json()),
    ]).then(([r, a]) => {
      setReels(r.records || []);
      setAccts(a.records || []);
      setLoading(false);
    });
  }, []);

  const groups = useMemo(() => {
    const byHandle: Record<string, any[]> = {};
    for (const r of reels) {
      const h = String(r.fields["Account Handle"] || "").toLowerCase();
      if (!h) continue;
      (byHandle[h] = byHandle[h] || []).push(r);
    }
    // Archived accounts (active === false) are dropped from this "current
    // roster" view entirely — including from the fallback below.
    const archived = new Set(
      accts.filter((a) => a.fields.Active === false).map((a) => String(a.fields.Handle || "").toLowerCase())
    );
    // order accounts by their total views desc
    const order = accts
      .filter((a) => a.fields.Active !== false)
      .map((a) => String(a.fields.Handle || "").toLowerCase())
      .filter((h) => byHandle[h]);
    // include any handles present in reels but not in the accounts list
    // (unless they belong to an archived account)
    for (const h of Object.keys(byHandle)) if (!order.includes(h) && !archived.has(h)) order.push(h);

    return order.map((h) => {
      const list = [...byHandle[h]].sort(
        (a, b) => Number(b.fields.Views || 0) - Number(a.fields.Views || 0)
      );
      const totalViews = list.reduce((s, r) => s + Number(r.fields.Views || 0), 0);
      return { handle: h, top: list.slice(0, n), count: list.length, totalViews };
    });
  }, [reels, accts, n]);

  return (
    <div>
      <h1 className="h1">Top Reels by Account</h1>
      <p className="sub">The highest-viewed reels for each of your accounts.</p>
      <ConfigBanner />

      <div className="row" style={{ marginBottom: 18 }}>
        <span className="muted" style={{ fontSize: 13 }}>Show top</span>
        <select value={n} onChange={(e) => setN(Number(e.target.value))}>
          {[3, 5, 10].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 13 }}>per account</span>
      </div>

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : groups.length === 0 ? (
        <p className="muted">No reels yet.</p>
      ) : (
        groups.map((g) => (
          <div className="panel" key={g.handle}>
            <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <a href={`https://instagram.com/${g.handle}`} target="_blank" rel="noreferrer">@{g.handle}</a>
              <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {g.count} reels · {fmt(g.totalViews)} total views
              </span>
            </h2>
            <div className="grid-reels">
              {g.top.map((r) => <ReelCard key={r.id} rec={r} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
