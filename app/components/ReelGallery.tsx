"use client";
import { useEffect, useMemo, useState } from "react";
import ReelCard from "./ReelCard";
import ConfigBanner from "./ConfigBanner";

export default function ReelGallery({ type, title, subtitle }: { type: "inspiration" | "our"; title: string; subtitle: string }) {
  const [recs, setRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("Views");
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    setLoading(true);
    fetch(`/api/reels?type=${type}`).then((r) => r.json()).then((j) => {
      setRecs(j.records || []);
      setLoading(false);
    });
  }
  useEffect(load, [type]);

  async function refresh() {
    setRefreshing(true);
    setMsg("Re-scraping metrics… this can take a minute.");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const j = await res.json();
      setMsg(j.error ? `Error: ${j.error}` : `Refreshed. ${JSON.stringify(j.summary)}`);
      load();
    } catch (e: any) {
      setMsg(`Error: ${e.message}`);
    }
    setRefreshing(false);
  }

  const filtered = useMemo(() => {
    let r = recs;
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) => {
        const f = x.fields;
        return (
          (f["Author Handle"] || f["Account Handle"] || "").toLowerCase().includes(s) ||
          (f.Caption || "").toLowerCase().includes(s) ||
          (f.Tags || []).join(" ").toLowerCase().includes(s)
        );
      });
    }
    return [...r].sort((a, b) => Number(b.fields[sort] || 0) - Number(a.fields[sort] || 0));
  }, [recs, q, sort]);

  return (
    <div>
      <h1 className="h1">{title}</h1>
      <p className="sub">{subtitle}</p>
      <ConfigBanner />

      <div className="row" style={{ marginBottom: 18 }}>
        <input placeholder="Search handle, caption, tag…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="Views">Sort: Views</option>
          <option value="Likes">Sort: Likes</option>
          <option value="Comments">Sort: Comments</option>
          <option value="Engagement Rate">Sort: Engagement</option>
        </select>
        <button className="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? <><span className="spinner" /> Refreshing…</> : "↻ Refresh metrics"}
        </button>
      </div>
      {msg && <p className="muted" style={{ marginBottom: 14 }}>{msg}</p>}

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No reels yet.</p>
      ) : (
        <div className="grid-reels">{filtered.map((r) => <ReelCard key={r.id} rec={r} />)}</div>
      )}
    </div>
  );
}
