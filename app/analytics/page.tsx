"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from "recharts";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";

const AXIS = { stroke: "#9a9ab0", fontSize: 12 };
const GRID = "#2a2a3d";

export default function Analytics() {
  const [our, setOur] = useState<any[]>([]);
  const [insp, setInsp] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/reels?type=our").then((r) => r.json()),
      fetch("/api/reels?type=inspiration").then((r) => r.json()),
      fetch("/api/snapshots").then((r) => r.json()),
    ]).then(([a, b, c]) => {
      setOur(a.records || []);
      setInsp(b.records || []);
      setSnaps(c.records || []);
      setLoading(false);
    });
  }, []);

  const topOur = useMemo(
    () =>
      [...our]
        .sort((a, b) => Number(b.fields.Views || 0) - Number(a.fields.Views || 0))
        .slice(0, 12)
        .map((r) => ({
          name: (r.fields.Shortcode || r.fields["Reel URL"] || "").toString().slice(-8),
          Views: Number(r.fields.Views || 0),
          Likes: Number(r.fields.Likes || 0),
        })),
    [our]
  );

  // Average views over time, per source, from snapshots.
  const trend = useMemo(() => {
    const byDate: Record<string, { date: string; Our: number[]; Inspiration: number[] }> = {};
    for (const s of snaps) {
      const f = s.fields;
      const d = f["Snapshot Date"];
      if (!d) continue;
      byDate[d] = byDate[d] || { date: d, Our: [], Inspiration: [] };
      (byDate[d] as any)[f.Source === "Our" ? "Our" : "Inspiration"].push(Number(f.Views || 0));
    }
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date.slice(5), Our: avg(d.Our), Inspiration: avg(d.Inspiration) }));
  }, [snaps]);

  const benchmark = useMemo(() => {
    const avgViews = (recs: any[]) => {
      const v = recs.map((r) => Number(r.fields.Views || 0));
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
    };
    return [
      { name: "Our reels", AvgViews: avgViews(our) },
      { name: "Inspiration", AvgViews: avgViews(insp) },
    ];
  }, [our, insp]);

  if (loading) return <div><h1 className="h1">Analytics</h1><p className="muted"><span className="spinner" /> Loading…</p></div>;

  return (
    <div>
      <h1 className="h1">Analytics</h1>
      <p className="sub">Performance trends across your reels and your benchmark vs. inspiration.</p>
      <ConfigBanner />

      <div className="panel">
        <h2>Top performing reels (ours)</h2>
        {topOur.length === 0 ? <p className="muted">No data yet.</p> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topOur}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="name" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={fmt} />
              <Tooltip contentStyle={{ background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
              <Bar dataKey="Views" fill="#e1306c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Average views over time (from metric snapshots)</h2>
        {trend.length === 0 ? <p className="muted">Refresh metrics a few times to build a trend line.</p> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS} />
              <YAxis tick={AXIS} tickFormatter={fmt} />
              <Tooltip contentStyle={{ background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey="Our" stroke="#e1306c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Inspiration" stroke="#833ab4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="panel">
        <h2>Benchmark: our avg views vs. inspiration</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={benchmark} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" tick={AXIS} tickFormatter={fmt} />
            <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
            <Tooltip contentStyle={{ background: "#14141f", border: "1px solid #2a2a3d", borderRadius: 8 }} formatter={(v: any) => fmt(v)} />
            <Bar dataKey="AvgViews" fill="#833ab4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
