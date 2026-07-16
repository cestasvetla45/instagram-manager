"use client";
import { useEffect, useState } from "react";

// Times are anchored to US Eastern (the strategy targets US audience).
// The page converts them live to the viewer's chosen timezone.
const SCHEDULE = [
  {
    h: 8, m: 0,
    title: "Morning warm-up + engagement",
    items: [
      "Reply to ALL overnight comments & DMs first — early replies boost engagement velocity and signal a real, active account.",
      "Like/comment on 10–15 in-niche posts (competitors + target accounts) to keep the account warm.",
      "Post 1 Story from the Vault — use a poll or question sticker to drive replies.",
    ],
  },
  {
    h: 12, m: 0,
    title: "Primary Reel #1 + push (US lunch — peak window)",
    items: [
      "Post the day's main reel — the proven format for THIS account's sub-niche (e.g. gaze/reaction for giantgirlamy & tallgirlkimxo, size-mismatch for tallchinesechick).",
      "First 30 min: reply to every comment as it lands. This early velocity is what gets the reel pushed wider.",
      "Post 1 Story pointing to the new reel (\"new post 👀\").",
      "Log the reel link in the Post Log below.",
      "Post 1 FRESH trial reel to non-followers — a NEW video every time, NEVER the same file (reposting the identical reel is what gets accounts suppressed). Log it in the Trial Tracker.",
    ],
  },
  {
    h: 15, m: 0,
    title: "Midday engagement + story",
    items: [
      "Reply to all comments on the midday reel.",
      "Post 1 Story from the Vault.",
      "Engage with 10 in-niche posts.",
    ],
  },
  {
    h: 19, m: 30,
    title: "Optional Reel #2 (US prime time) + close out",
    items: [
      "Only post a 2nd reel if it's ready AND it's ≥6 hours after Reel #1. Hard cap: 2 reels/day, never two within ~6h.",
      "Post 1–2 Stories (Vault image + a question to drive replies).",
      "Reply to ALL remaining comments & DMs from the day.",
      "Log every link below.",
    ],
  },
];

const QUOTAS = [
  ["Reels", "1 min – 2 max per day, ≥6h apart"],
  ["Stories", "3–5 per day, spread across the day"],
  ["Comment replies", "Reply to ALL — especially the first hour after each reel"],
  ["Outbound engagement", "20–30 in-niche likes/comments per day"],
  ["Logging", "Paste every reel + story link in the Post Log"],
];

const ZONES: Record<string, { tz: string; label: string }> = {
  ET: { tz: "America/New_York", label: "ET" },
  UTC: { tz: "UTC", label: "UTC" },
  MNL: { tz: "Asia/Manila", label: "Manila" },
};

// offset (minutes ahead of UTC) of a timezone at a given instant
function tzOffset(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const m: any = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour === 24 ? 0 : +m.hour, +m.minute, +m.second);
  return (asUTC - date.getTime()) / 60000;
}

// The UTC instant whose Eastern wall-clock time is h:m today.
function easternWallToInstant(h: number, m: number): Date {
  const now = new Date();
  const d: any = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  const guess = new Date(Date.UTC(+d.year, +d.month - 1, +d.day, h, m, 0));
  const off = tzOffset("America/New_York", guess); // minutes (ET is negative)
  return new Date(guess.getTime() - off * 60000);
}

function timeIn(h: number, m: number, zoneKey: string): string {
  const z = ZONES[zoneKey] || ZONES.ET;
  const inst = easternWallToInstant(h, m);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: z.tz, hour: "numeric", minute: "2-digit", hour12: true }).format(inst);
  return `${t} ${z.label}`;
}

const TOTAL_TASKS = SCHEDULE.reduce((s, b) => s + b.items.length, 0);
function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function VADailyPage() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [vaultFilter, setVaultFilter] = useState("false"); // default: show UNUSED
  const [msg, setMsg] = useState("");
  const [zone, setZone] = useState("ET");

  useEffect(() => {
    const z = typeof window !== "undefined" ? localStorage.getItem("va_zone") : null;
    if (z && ZONES[z]) setZone(z);
  }, []);
  function changeZone(z: string) {
    setZone(z);
    try { localStorage.setItem("va_zone", z); } catch {}
  }

  // log form
  const [acct, setAcct] = useState("");
  const [ptype, setPtype] = useState("reel");
  const [link, setLink] = useState("");
  const [vaName, setVaName] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  // checklist + active accounts
  const [clAcct, setClAcct] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [acctView, setAcctView] = useState<any[]>([]);
  const etDay = etToday();

  function loadAccountsView() {
    fetch(`/api/va/accounts?day=${etDay}`).then((r) => r.json()).then((j) => setAcctView(j.accounts || []));
  }
  function loadChecklist(a: string) {
    if (!a) { setDone(new Set()); return; }
    fetch(`/api/va/checklist?account=${encodeURIComponent(a)}&day=${etDay}`).then((r) => r.json()).then((j) => setDone(new Set(j.done || [])));
  }
  async function toggleTask(key: string) {
    const isDone = done.has(key);
    const next = new Set(done);
    isDone ? next.delete(key) : next.add(key);
    setDone(next);
    await fetch("/api/va/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: clAcct, day: etDay, task_key: key, done: !isDone, va_name: vaName }),
    });
    loadAccountsView();
  }
  async function toggleActive(handle: string, active: boolean) {
    await fetch("/api/va/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, active }),
    });
    loadAccountsView();
  }

  // Day / Week view + 7-day planner + trial tracker
  const [view, setView] = useState<"day" | "week">("day");
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [trials, setTrials] = useState<any[]>([]);
  const [trConcept, setTrConcept] = useState("");
  const [trLink, setTrLink] = useState("");
  const [trViews, setTrViews] = useState("");

  const weekDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDays.push(new Date(Date.now() + i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  }
  const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  function loadPlan(a: string) {
    if (!a) return;
    fetch(`/api/va/plan?account=${encodeURIComponent(a)}&from=${weekDays[0]}&to=${weekDays[6]}`).then((r) => r.json()).then((j) => setPlan(j.plan || {}));
  }
  async function savePlan(day: string, content: string) {
    setPlan((p) => ({ ...p, [day]: content }));
    await fetch("/api/va/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: clAcct, day, content }) });
  }
  function loadTrials() {
    fetch(`/api/va/trials?account=ALL`).then((r) => r.json()).then((j) => setTrials(j.trials || []));
  }
  async function logTrial() {
    if (!trLink.trim() && !trConcept.trim()) { setMsg("Add a trial reel link or concept."); return; }
    await fetch("/api/va/trials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_handle: clAcct, concept: trConcept, reel_link: trLink, views: trViews, va_name: vaName }) });
    setTrConcept(""); setTrLink(""); setTrViews(""); setMsg("Trial logged ✓"); loadTrials();
  }

  function loadPosts() {
    fetch("/api/va/posts").then((r) => r.json()).then((j) => setPosts(j.posts || []));
  }
  function loadVault() {
    fetch(`/api/va/vault?used=${vaultFilter}`).then((r) => r.json()).then((j) => setAssets(j.assets || []));
  }
  useEffect(() => {
    fetch("/api/accounts?type=our").then((r) => r.json()).then((j) => {
      const h = (j.records || []).map((a: any) => a.fields.Handle).filter(Boolean);
      setAccounts(h);
      if (h.length) { setAcct(h[0]); setClAcct(h[0]); }
    });
    loadPosts();
    loadAccountsView();
    loadTrials();
  }, []);
  useEffect(loadVault, [vaultFilter]);
  useEffect(() => { loadChecklist(clAcct); loadPlan(clAcct); }, [clAcct]);

  async function logPost() {
    if (!link.trim() && !note.trim()) { setMsg("Add a link (or a note)."); return; }
    await fetch("/api/va/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_handle: acct, post_type: ptype, link, note, va_name: vaName, posted_at: new Date().toISOString() }),
    });
    setLink(""); setNote(""); setMsg("Logged ✓"); loadPosts();
  }

  async function uploadImages(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true); setMsg(`Uploading ${files.length} image(s) to the vault…`);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    const res = await fetch("/api/va/vault", { method: "POST", body: fd });
    const j = await res.json();
    setMsg(j.error ? `Error: ${j.error}` : `Added ${j.added} image(s) to the vault.`);
    setUploading(false); loadVault();
  }

  async function toggleUsed(a: any) {
    await fetch("/api/va/vault", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, used: !a.used, used_by: !a.used ? (vaName || "VA") : null }),
    });
    loadVault();
  }

  return (
    <div>
      <h1 className="h1">VA Daily</h1>
      <p className="sub">The daily operating routine — times target US peak windows (switch the timezone in the schedule). 1–2 reels/day max. Log every post & story; pull story images from the vault.</p>
      {msg && <p className="muted" style={{ marginBottom: 12 }}>{msg}</p>}

      {/* Active accounts — today */}
      <div className="panel">
        <h2>Active accounts — today ({etDay} ET)</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>Click an account to load its checklist below. Toggle paused for suspended/inactive accounts.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {acctView.map((a) => {
            const pct = Math.round((a.done_today / TOTAL_TASKS) * 100);
            const sel = a.handle === clAcct;
            return (
              <div key={a.handle} onClick={() => setClAcct(a.handle)} style={{ cursor: "pointer", border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: "10px 12px", opacity: a.active ? 1 : 0.5 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ fontSize: 14 }}>@{a.handle}</b>
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleActive(a.handle, !a.active); }}
                    className="badge"
                    style={{ cursor: "pointer", background: a.active ? "var(--accent)" : "var(--panel-2)", color: a.active ? "#fff" : "var(--muted)" }}
                  >
                    {a.active ? "active" : "paused"}
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--panel-2)", borderRadius: 4, margin: "8px 0 4px", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#16a34a" : "var(--accent)" }} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{a.done_today}/{TOTAL_TASKS} tasks · {a.reels_today} reel{a.reels_today === 1 ? "" : "s"} today</div>
              </div>
            );
          })}
          {acctView.length === 0 && <p className="muted">No accounts yet.</p>}
        </div>
      </div>

      {/* Day / Week toggle */}
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className={view === "day" ? "" : "secondary"} onClick={() => setView("day")}>✓ Day checklist</button>
        <button className={view === "week" ? "" : "secondary"} onClick={() => setView("week")}>🗓 7-day planner</button>
      </div>

      {/* Daily schedule (Day view) */}
      {view === "day" && (
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Checklist for{" "}
            <select value={clAcct} onChange={(e) => setClAcct(e.target.value)} style={{ fontSize: 15 }}>
              {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>{done.size}/{TOTAL_TASKS} done</span>
          </h2>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 12 }}>Timezone</span>
            <select value={zone} onChange={(e) => changeZone(e.target.value)}>
              <option value="ET">Eastern (ET)</option>
              <option value="UTC">UTC</option>
              <option value="MNL">Manila (PHT)</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {SCHEDULE.map((b, bi) => (
            <div key={b.title} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="badge" style={{ background: "var(--accent)", color: "#fff" }}>{timeIn(b.h, b.m, zone)}</span>
                <b>{b.title}</b>
              </div>
              <div style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
                {b.items.map((it, ii) => {
                  const key = `b${bi}i${ii}`;
                  const checked = done.has(key);
                  return (
                    <label key={ii} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0", cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleTask(key)} style={{ marginTop: 4 }} />
                      <span style={{ textDecoration: checked ? "line-through" : "none", opacity: checked ? 0.6 : 1 }}>{it}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 15 }}>Daily quotas</h2>
          <table><tbody>
            {QUOTAS.map(([k, v]) => (
              <tr key={k}><td style={{ fontWeight: 600, width: 180 }}>{k}</td><td className="muted">{v}</td></tr>
            ))}
          </tbody></table>
        </div>
      </div>
      )}

      {/* 7-day planner (Week view) */}
      {view === "week" && (
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>7-day plan —{" "}
            <select value={clAcct} onChange={(e) => setClAcct(e.target.value)} style={{ fontSize: 15 }}>
              {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
            </select>
          </h2>
          <span className="muted" style={{ fontSize: 12 }}>Plan reels / trials / carousels / stories per day</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginTop: 10 }}>
          {weekDays.map((d, i) => (
            <div key={d} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{dayLabel(d)}{i === 0 ? " · today" : ""}</div>
              <textarea
                value={plan[d] || ""}
                onChange={(e) => setPlan((p) => ({ ...p, [d]: e.target.value }))}
                onBlur={(e) => savePlan(d, e.target.value)}
                placeholder={"Reel: …\nTrial: …\nCarousel: …\nStory: …"}
                rows={5}
                style={{ width: "100%", resize: "vertical", fontSize: 12 }}
              />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Trial reel tracker */}
      <div className="panel">
        <h2>Trial reel tracker</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>Log each FRESH trial reel + its views. When views for the same concept start falling, retire it BEFORE it drags the account down. Never repost the same file.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={clAcct} onChange={(e) => setClAcct(e.target.value)} style={{ minWidth: 140 }}>
            {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
          </select>
          <input placeholder="Concept (e.g. shower / gaze)" value={trConcept} onChange={(e) => setTrConcept(e.target.value)} style={{ minWidth: 160 }} />
          <input placeholder="Trial reel link" value={trLink} onChange={(e) => setTrLink(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <input placeholder="Views" value={trViews} onChange={(e) => setTrViews(e.target.value)} style={{ width: 90 }} />
          <button onClick={logTrial}>Log trial</button>
        </div>
        {trials.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Account</th><th>Concept</th><th>Views</th><th>Link</th></tr></thead>
            <tbody>
              {trials.slice(0, 80).map((t) => (
                <tr key={t.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(t.posted_at || t.logged_at).toLocaleDateString()}</td>
                  <td>@{t.account_handle}</td>
                  <td>{t.concept || "—"}</td>
                  <td>{t.views != null ? Number(t.views).toLocaleString() : "—"}</td>
                  <td>{t.reel_link ? <a href={t.reel_link} target="_blank" rel="noreferrer" className="badge">open</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Post log */}
      <div className="panel">
        <h2>Post / Story log</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>Paste the link of every reel/post you publish (and stories — a highlight link or a note works). This is how we monitor performance.</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={acct} onChange={(e) => setAcct(e.target.value)} style={{ minWidth: 150 }}>
            {accounts.map((h) => <option key={h} value={h}>@{h}</option>)}
          </select>
          <select value={ptype} onChange={(e) => setPtype(e.target.value)}>
            <option value="reel">Reel</option>
            <option value="story">Story</option>
            <option value="post">Post</option>
          </select>
          <input placeholder="Link (reel/post URL, or story/highlight link)" value={link} onChange={(e) => setLink(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <input placeholder="VA name" value={vaName} onChange={(e) => setVaName(e.target.value)} style={{ width: 120 }} />
          <button onClick={logPost}>Log</button>
        </div>
        <input placeholder="Note (optional — e.g. story metrics, concept used)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
        {posts.length > 0 && (
          <table>
            <thead><tr><th>When</th><th>Account</th><th>Type</th><th>Link</th><th>VA</th><th>Note</th></tr></thead>
            <tbody>
              {posts.slice(0, 60).map((p) => (
                <tr key={p.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(p.posted_at || p.logged_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td>@{p.account_handle}</td>
                  <td>{p.post_type}</td>
                  <td>{p.link ? <a href={p.link} target="_blank" rel="noreferrer" className="badge">open</a> : <span className="muted">—</span>}</td>
                  <td className="muted">{p.va_name || "—"}</td>
                  <td className="muted" style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Story vault */}
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Story image vault</h2>
          <div className="row" style={{ gap: 8 }}>
            <select value={vaultFilter} onChange={(e) => setVaultFilter(e.target.value)}>
              <option value="false">Unused</option>
              <option value="true">Used</option>
              <option value="all">All</option>
            </select>
            <label style={{ cursor: "pointer", display: "inline-block", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px", fontSize: 14 }}>
              {uploading ? <><span className="spinner" /> Uploading…</> : "⤓ Upload images"}
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => uploadImages(e.target.files)} />
            </label>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>Pick an image for a story, post it, then tap “Mark used” so the next VA doesn&rsquo;t repost it.</p>
        {assets.length === 0 ? (
          <p className="muted">No images here yet. Upload some to build the vault.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {assets.map((a) => (
              <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", opacity: a.used ? 0.55 : 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.image_url} alt={a.label || "story"} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} loading="lazy" />
                <div style={{ padding: "6px 8px" }}>
                  {a.used ? (
                    <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>used{a.used_by ? ` · ${a.used_by}` : ""}{a.used_at ? ` · ${new Date(a.used_at).toLocaleDateString()}` : ""}</div>
                  ) : null}
                  <button className={a.used ? "secondary" : ""} onClick={() => toggleUsed(a)} style={{ width: "100%", fontSize: 12, padding: "4px 0" }}>
                    {a.used ? "↺ Mark unused" : "✓ Mark used"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
