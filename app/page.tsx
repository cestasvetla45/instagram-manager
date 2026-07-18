"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ConfigBanner from "./components/ConfigBanner";
import ReelCard from "./components/ReelCard";
import { fmt, pct } from "./components/util";

type TgStatus = {
  configured: boolean;
  online?: boolean;
  bot?: { username: string; name: string } | null;
  authorized_users?: number | null;
};

export default function Overview() {
  const [insp, setInsp] = useState<any[]>([]);
  const [inspTotal, setInspTotal] = useState(0);
  const [our, setOur] = useState<any[]>([]);
  const [ourTotal, setOurTotal] = useState(0);
  const [accts, setAccts] = useState<any[]>([]);
  const [ourAccts, setOurAccts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tg, setTg] = useState<TgStatus | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/reels?type=inspiration").then((r) => r.json()),
      // limit=500 covers "our" reels in full so total views / avg ER aren't
      // skewed by only sampling the top-200-by-views slice.
      fetch("/api/reels?type=our&limit=500").then((r) => r.json()),
      fetch("/api/accounts?type=inspiration").then((r) => r.json()),
      fetch("/api/accounts?type=our").then((r) => r.json()),
    ]).then(([a, b, c, d]) => {
      setInsp(a.records || []);
      setInspTotal(a.total ?? (a.records || []).length);
      setOur(b.records || []);
      setOurTotal(b.total ?? (b.records || []).length);
      setAccts(c.records || []);
      setOurAccts(d.records || []);
      setLoading(false);
    });
    fetch("/api/telegram/status").then((r) => r.json()).then(setTg).catch(() => {});
  }, []);

  const avgER = (recs: any[]) => {
    const vals = recs.map((r) => Number(r.fields["Engagement Rate"] || 0)).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const totalViews = (recs: any[]) => recs.reduce((s, r) => s + Number(r.fields.Views || 0), 0);

  // Archived accounts (active === false) are excluded from the "our" totals —
  // otherwise a banned/retired account's reels keep inflating the headline stats.
  const activeOurHandles = new Set(
    ourAccts.filter((a) => a.fields.Active !== false).map((a) => String(a.fields.Handle || "").toLowerCase())
  );
  const ourActive = our.filter((r) => activeOurHandles.has(String(r.fields["Account Handle"] || "").toLowerCase()));

  return (
    <div>
      <h1 className="h1">Overview</h1>
      <p className="sub">Your reel research lab and account performance at a glance.</p>
      <ConfigBanner />

      <div className="cards">
        <div className="card"><div className="k">Inspiration reels</div><div className="v">{fmt(inspTotal)}</div></div>
        <div className="card"><div className="k">Our reels tracked</div><div className="v">{fmt(ourTotal)}</div></div>
        <div className="card"><div className="k">Accounts watched</div><div className="v">{accts.length + ourAccts.filter((a) => a.fields.Active !== false).length}</div></div>
        <div className="card"><div className="k">Our total views</div><div className="v">{fmt(totalViews(ourActive))}</div></div>
        <div className="card"><div className="k">Our avg ER</div><div className="v">{pct(avgER(ourActive))}</div></div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>🤖 Telegram bot</h2>
          <Link href="/telegram-users" style={{ color: "var(--accent)", fontSize: 13 }}>Manage users →</Link>
        </div>
        {!tg ? (
          <p className="muted" style={{ margin: 0 }}><span className="spinner" /> Loading…</p>
        ) : !tg.configured ? (
          <p className="muted" style={{ margin: 0 }}>Not configured — set <code>TELEGRAM_BOT_TOKEN</code> in Railway.</p>
        ) : (
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Status</div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{tg.online ? "🟢 Online" : "🔴 Offline"}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Bot</div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                {tg.bot ? (
                  <a href={`https://t.me/${tg.bot.username}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>@{tg.bot.username}</a>
                ) : "—"}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Authorized users</div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{tg.authorized_users ?? "—"}</div>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Top inspiration reels by views</h2>
        {loading ? (
          <p className="muted"><span className="spinner" /> Loading…</p>
        ) : insp.length === 0 ? (
          <p className="muted">Nothing yet. Go to <b>Add / Scrape</b> and paste some reel links.</p>
        ) : (
          <div className="grid-reels">
            {insp.slice(0, 10).map((r) => <ReelCard key={r.id} rec={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
