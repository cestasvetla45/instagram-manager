"use client";
import { useEffect, useState } from "react";
import ConfigBanner from "../components/ConfigBanner";
import { fmt } from "../components/util";
import { scoreColor } from "@/lib/score";

type Candidate = {
  id: string;
  handle: string;
  status: string;
  sources: Record<string, number>;
  source_count: number;
  source_handles: string[];
  full_name: string | null;
  bio: string | null;
  followers: number | null;
  posts_count: number | null;
  clips_count: number | null;
  profile_pic_url: string | null;
  discovery_score: number | null;
  avg_views: number | null;
  max_views: number | null;
  view_follow_ratio: number | null;
  last_posted_at: string | null;
  top_reels: { url: string; views: number; thumbnail_url: string | null }[];
  ai_niche: string | null;
  ai_fit: number | null;
  ai_reason: string | null;
  reject_reason: string | null;
};

type Settings = {
  minFollowers: number;
  maxFollowers: number;
  minScore: number;
  maxAgeDays: number;
  commentReels: number;
  vetBudget: number;
  useAi: boolean;
  classifyFormat: boolean;
  assumeNiche: boolean;
};

const SETTING_FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "minFollowers", label: "Min followers", hint: "reject smaller accounts" },
  { key: "maxFollowers", label: "Max followers", hint: "skip celebrities / brands" },
  { key: "minScore", label: "Min score (0–10)", hint: "quality bar to suggest" },
  { key: "maxAgeDays", label: "Max days since post", hint: "must be active/trending" },
  { key: "commentReels", label: "Comment scans / cycle", hint: "scraper-heavy; keep low" },
  { key: "vetBudget", label: "Accounts vetted / cycle", hint: "scraper-heavy; keep low" },
];

function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/discovery/settings").then((r) => r.json()).then((j) => j.settings && setS(j.settings));
  }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setMsg("");
    try {
      const j = await fetch("/api/discovery/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setS(j.settings);
      setMsg("Saved — the worker uses these on its next cycle.");
    } catch (e: any) {
      setMsg(`Error: ${e?.message || String(e)}`);
    }
    setSaving(false);
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <b>⚙ Discovery tuning</b>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </div>
      {open && s ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {SETTING_FIELDS.map((f) => (
              <label key={f.key} style={{ fontSize: 12 }}>
                <div className="muted">{f.label}</div>
                <input
                  type="number"
                  value={s[f.key] as number}
                  onChange={(e) => set(f.key, Number(e.target.value) as any)}
                  style={{ width: "100%", marginTop: 2 }}
                />
                <div className="muted" style={{ fontSize: 11 }}>{f.hint}</div>
              </label>
            ))}
          </div>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input type="checkbox" checked={s.useAi} onChange={(e) => set("useAi", e.target.checked)} />
            Use AI to guess each creator&apos;s niche &amp; fit (needs GEMINI_API_KEY)
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <input type="checkbox" checked={s.assumeNiche} onChange={(e) => set("assumeNiche", e.target.checked)} />
            Assume a niche when scraping (inherit, or AI-guess if unknown)
          </label>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <input type="checkbox" checked={s.classifyFormat} onChange={(e) => set("classifyFormat", e.target.checked)} />
            Classify single- vs multi-person on scraped reels (thumbnail)
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save settings"}</button>
            {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
          </div>
        </div>
      ) : open ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}><span className="spinner" /> Loading…</p>
      ) : null}
    </div>
  );
}

const TABS: { key: string; label: string }[] = [
  { key: "suggested", label: "Suggested" },
  { key: "pending", label: "Queue" },
  { key: "approved", label: "Approved" },
  { key: "rejected_auto", label: "Auto-rejected" },
  { key: "rejected", label: "Rejected" },
];

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <span
      style={{
        background: scoreColor(score),
        color: "#fff",
        borderRadius: 6,
        padding: "2px 8px",
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {Number(score).toFixed(1)}
    </span>
  );
}

function sourceLine(c: Candidate): string {
  const parts = Object.entries(c.sources || {}).map(([k, v]) => `${v}× ${k}`);
  const via = (c.source_handles || []).slice(0, 3).map((h) => "@" + h).join(", ");
  return `${parts.join(" · ") || "—"}${via ? ` (via ${via}${(c.source_handles || []).length > 3 ? "…" : ""})` : ""}`;
}

function CandidateCard({
  c,
  niches,
  onDecided,
}: {
  c: Candidate;
  niches: string[];
  onDecided: () => void;
}) {
  const [niche, setNiche] = useState(c.ai_niche || "");
  const [importNow, setImportNow] = useState(true);
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [err, setErr] = useState("");
  const actionable = c.status === "suggested" || c.status === "pending" || c.status === "rejected_auto";

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setErr("");
    try {
      const res = await fetch("/api/discovery/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, decision, niche, importNow: decision === "approve" && importNow }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      onDecided();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy("");
    }
  }

  return (
    <div className="panel" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      {c.profile_pic_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.profile_pic_url} alt="" style={{ width: 56, height: 56, borderRadius: "50%", flexShrink: 0 }} loading="lazy" decoding="async" />
      ) : (
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#333", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <a href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            @{c.handle}
          </a>
          <ScoreBadge score={c.discovery_score} />
          {c.ai_niche ? (
            <span className="muted" style={{ fontSize: 13 }}>
              AI: {c.ai_niche}
              {c.ai_fit != null ? ` (${Math.round(c.ai_fit * 100)}% fit)` : ""}
            </span>
          ) : null}
        </div>
        {c.full_name ? <div className="muted" style={{ fontSize: 13 }}>{c.full_name}</div> : null}
        <div style={{ fontSize: 13, margin: "6px 0", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span><b>{fmt(c.followers)}</b> followers</span>
          {c.clips_count != null ? <span><b>{fmt(c.clips_count)}</b> reels</span> : null}
          {c.avg_views != null ? <span>avg <b>{fmt(c.avg_views)}</b> views</span> : null}
          {c.max_views != null ? <span>best <b>{fmt(c.max_views)}</b></span> : null}
          {c.view_follow_ratio != null && c.view_follow_ratio > 0 ? <span><b>{c.view_follow_ratio}×</b> views/follower</span> : null}
        </div>
        {c.bio ? (
          <div className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>
            {c.bio}
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Seen: {sourceLine(c)}</div>
        {c.ai_reason ? <div className="muted" style={{ fontSize: 12 }}>{c.ai_reason}</div> : null}
        {c.reject_reason ? (
          <div style={{ fontSize: 12, color: "#f97316", marginTop: 4 }}>Auto: {c.reject_reason}</div>
        ) : null}
        {(c.top_reels || []).length ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {(c.top_reels || []).map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noreferrer" title={`${fmt(r.views)} views`}>
                {r.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail_url} alt="" style={{ width: 64, height: 96, objectFit: "cover", borderRadius: 8 }} loading="lazy" decoding="async" />
                ) : (
                  <span style={{ fontSize: 12 }}>{fmt(r.views)} views ↗</span>
                )}
              </a>
            ))}
          </div>
        ) : null}
        {err ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{err}</div> : null}
      </div>
      {actionable ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, minWidth: 170 }}>
          <select value={niche} onChange={(e) => setNiche(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">niche: (none)</option>
            {[...new Set([...(c.ai_niche ? [c.ai_niche] : []), ...niches])].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={importNow} onChange={(e) => setImportNow(e.target.checked)} />
            import top reels now
          </label>
          <button disabled={!!busy} onClick={() => decide("approve")}>
            {busy === "approve" ? "Adding…" : "✓ Add to library"}
          </button>
          <button className="secondary" disabled={!!busy} onClick={() => decide("reject")}>
            {busy === "reject" ? "…" : "✕ Reject"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function DiscoveryPage() {
  const [tab, setTab] = useState("suggested");
  const [cands, setCands] = useState<Candidate[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [niches, setNiches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  async function load(t = tab) {
    setLoading(true);
    const j = await fetch(`/api/discovery?status=${t}`).then((r) => r.json());
    setCands(j.candidates || []);
    setCounts(j.counts || {});
    setLoading(false);
  }

  useEffect(() => {
    load(tab);
  }, [tab]);
  useEffect(() => {
    fetch("/api/niches").then((r) => r.json()).then((j) => setNiches((j.niches || []).map((n: any) => n.name)));
  }, []);

  async function runNow() {
    setRunning(true);
    setRunMsg("");
    try {
      const j = await fetch("/api/discovery/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setRunMsg(
        `Scanned ${j.mentions?.scanned ?? 0} captions (+${j.mentions?.newCandidates ?? 0} new), ` +
        `mined ${j.commenters?.reels ?? 0} comment sections (+${j.commenters?.found ?? 0}), ` +
        `vetted ${j.vetting?.vetted ?? 0} → ${j.vetting?.suggested ?? 0} suggested. ` +
        `Queue: ${j.queue?.pending ?? 0} waiting.`
      );
      await load();
    } catch (e: any) {
      setRunMsg(`Error: ${e?.message || String(e)}`);
    }
    setRunning(false);
  }

  return (
    <div>
      <h1 className="h1">Creator Discovery</h1>
      <p className="sub">
        New creators found automatically from caption mentions, collabs and commenters on your best inspiration reels —
        vetted by profile + recent-reel performance. Approve the good ones into the inspiration library.
      </p>
      <ConfigBanner />
      <SettingsPanel />

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "" : "secondary"}
            onClick={() => setTab(t.key)}
            style={{ fontSize: 13 }}
          >
            {t.label}
            {counts[t.key] != null ? ` (${counts[t.key]})` : ""}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button disabled={running} onClick={runNow} style={{ fontSize: 13 }}>
          {running ? "Running…" : "▶ Run discovery now"}
        </button>
      </div>
      {runMsg ? <p className="muted" style={{ fontSize: 13 }}>{runMsg}</p> : null}

      {loading ? (
        <p className="muted"><span className="spinner" /> Loading…</p>
      ) : !cands.length ? (
        <p className="muted">
          {tab === "suggested"
            ? "Nothing suggested yet — the worker harvests and vets candidates each cycle, or hit “Run discovery now”."
            : "Empty."}
        </p>
      ) : (
        cands.map((c) => <CandidateCard key={c.id} c={c} niches={niches} onDecided={() => load()} />)
      )}
    </div>
  );
}
