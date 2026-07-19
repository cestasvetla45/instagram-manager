"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fmt, attachUrl } from "../../components/util";
import ConfigBanner from "../../components/ConfigBanner";

const PAGE_SIZE = 60;

type Account = {
  handle: string;
  full_name: string | null;
  followers: number;
  profile_pic_url: string | null;
  enriched_at: string | null;
  scrape_status: string | null;
};

type Stats = { profile_count: number; reel_count: number; total_views: number; avg_views: number; picked_count: number };

export default function CategoryDetailPage() {
  const params = useParams();
  const name = decodeURIComponent(String(params?.name || ""));

  const [category, setCategory] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingHeader, setLoadingHeader] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [msg, setMsg] = useState("");

  const [allCategoryNames, setAllCategoryNames] = useState<string[]>([]);

  // Guards against a slow, superseded request clobbering a fresher one (see
  // the identical comment on the hub page's load()).
  const headerRequestIdRef = useRef(0);

  const loadHeader = useCallback(() => {
    const myRequestId = ++headerRequestIdRef.current;
    setLoadingHeader(true);
    fetch(`/api/categories/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((j) => {
        if (myRequestId !== headerRequestIdRef.current) return;
        if (j.error) { setNotFound(true); return; }
        setCategory(j.category);
        setAccounts(j.accounts || []);
        setStats(j.stats || null);
      })
      .catch((e) => { if (myRequestId === headerRequestIdRef.current) setMsg(`Error: ${e.message || e}`); })
      .finally(() => { if (myRequestId === headerRequestIdRef.current) setLoadingHeader(false); });
  }, [name]);

  useEffect(() => { loadHeader(); }, [loadHeader]);
  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then((j) => setAllCategoryNames((j.categories || []).map((c: any) => c.name))).catch(() => {});
  }, []);

  const handles = useMemo(() => accounts.map((a) => a.handle), [accounts]);

  if (notFound) {
    return (
      <div>
        <p className="muted"><Link href="/categories">← Categories</Link></p>
        <div className="panel">Category "{name}" not found. <Link href="/categories">Go back.</Link></div>
      </div>
    );
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 4 }}><Link href="/categories">← Categories</Link></p>
      <h1 className="h1">{name}</h1>
      <ConfigBanner />

      {loadingHeader ? (
        <div style={{ padding: 12 }}><span className="spinner" /> Loading…</div>
      ) : stats ? (
        <div className="row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 8, fontSize: 14 }}>
          <span><b>{stats.profile_count}</b> <span className="muted">profiles</span></span>
          <span><b>{stats.reel_count}</b> <span className="muted">reels</span></span>
          <span><b>{fmt(stats.total_views)}</b> <span className="muted">total views</span></span>
          <span><b>{fmt(stats.avg_views)}</b> <span className="muted">avg views</span></span>
          <span>⭐ <b>{stats.picked_count}</b> picked of {stats.reel_count}</span>
        </div>
      ) : null}

      {msg && (
        <div className="banner" style={{ marginBottom: 14 }}>
          {msg} <button className="secondary" style={{ marginLeft: 10, fontSize: 11, padding: "2px 8px" }} onClick={() => setMsg("")}>dismiss</button>
        </div>
      )}

      <ProfilesSection
        name={name}
        accounts={accounts}
        otherCategories={allCategoryNames.filter((n) => n.toLowerCase() !== name.toLowerCase())}
        onChanged={loadHeader}
        onError={setMsg}
      />

      <ReelsSection name={name} handles={handles} onWinnerChange={loadHeader} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  PROFILES
// ─────────────────────────────────────────────────────────────
function ProfilesSection({
  name,
  accounts,
  otherCategories,
  onChanged,
  onError,
}: {
  name: string;
  accounts: Account[];
  otherCategories: string[];
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [addVal, setAddVal] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  function setRowBusy(h: string, on: boolean) {
    setBusy((prev) => { const n = new Set(prev); on ? n.add(h) : n.delete(h); return n; });
  }

  async function addProfile() {
    const val = addVal.trim();
    if (!val) return;
    setAdding(true);
    try {
      const j = await fetch(`/api/categories/${encodeURIComponent(name)}/profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: val }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setAddVal("");
      onChanged();
    } catch (e: any) {
      onError(`Add profile failed: ${e.message || e}`);
    } finally {
      setAdding(false);
    }
  }

  async function removeProfile(handle: string) {
    if (!confirm(`Remove @${handle} from "${name}"? The account and its reels stay — it just leaves this category.`)) return;
    setRowBusy(handle, true);
    try {
      const j = await fetch(`/api/categories/${encodeURIComponent(name)}/profiles`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      onChanged();
    } catch (e: any) {
      onError(`Remove failed: ${e.message || e}`);
    } finally {
      setRowBusy(handle, false);
    }
  }

  async function moveProfile(handle: string, to: string) {
    if (!to) return;
    setRowBusy(handle, true);
    try {
      const j = await fetch(`/api/categories/${encodeURIComponent(name)}/profiles`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, to }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      onChanged();
    } catch (e: any) {
      onError(`Move failed: ${e.message || e}`);
    } finally {
      setRowBusy(handle, false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Profiles</h2>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <input
          placeholder="@handle or instagram.com/handle"
          value={addVal}
          onChange={(e) => setAddVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addProfile()}
          style={{ minWidth: 260 }}
        />
        <button onClick={addProfile} disabled={adding || !addVal.trim()}>
          {adding ? <><span className="spinner" /> Adding…</> : "Add profile"}
        </button>
      </div>

      {!accounts.length ? (
        <div className="muted">No profiles yet. Add one above to start pulling reels into this category.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {accounts.map((a) => (
            <div key={a.handle} className="panel" style={{ margin: 0, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, background: "var(--panel-2)" }}>
              {a.profile_pic_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.profile_pic_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--panel)" }} />
              )}
              <div>
                <a href={`https://instagram.com/${a.handle}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 13 }}>@{a.handle}</a>
                <div className="muted" style={{ fontSize: 11 }}>{fmt(a.followers)} followers</div>
                {!a.enriched_at && <span className="badge" style={{ fontSize: 10, marginTop: 2, display: "inline-block" }}>⏳ importing reels…</span>}
                {a.scrape_status === "inaccessible" && <span className="badge" style={{ fontSize: 10, color: "#e74c3c", borderColor: "#e74c3c" }}>inaccessible</span>}
              </div>
              <div className="row" style={{ gap: 4, marginLeft: 4 }}>
                <select
                  value=""
                  disabled={busy.has(a.handle) || !otherCategories.length}
                  onChange={(e) => { if (e.target.value) moveProfile(a.handle, e.target.value); e.target.value = ""; }}
                  style={{ fontSize: 11, padding: "3px 4px" }}
                  title="Move to another category"
                >
                  <option value="">move…</option>
                  {otherCategories.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button
                  className="secondary"
                  onClick={() => removeProfile(a.handle)}
                  disabled={busy.has(a.handle)}
                  style={{ fontSize: 11, padding: "3px 8px", color: "#e74c3c", borderColor: "#e74c3c" }}
                >
                  {busy.has(a.handle) ? <span className="spinner" /> : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  REELS
// ─────────────────────────────────────────────────────────────
function ReelsSection({ name, handles, onWinnerChange }: { name: string; handles: string[]; onWinnerChange: () => void }) {
  const [reels, setReels] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("views"); // views | posted | viral
  const [minViews, setMinViews] = useState<number>(0);
  const [pickedOnly, setPickedOnly] = useState(false);
  // Same out-of-order-response guard as the hub/header loaders above —
  // matters even more here since "Load more" fires overlapping requests.
  const reelsRequestIdRef = useRef(0);

  const load = useCallback((reset: boolean) => {
    if (!handles.length) { setReels([]); setTotal(0); return; }
    const myRequestId = ++reelsRequestIdRef.current;
    setLoading(true);
    const p = new URLSearchParams({
      authors: handles.join(","),
      page: String(reset ? 1 : page),
      limit: String(PAGE_SIZE),
      sort,
    });
    if (minViews > 0) p.set("minViews", String(minViews));
    if (pickedOnly) p.set("winners", "true");
    fetch(`/api/inspiration-reels/manage?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (myRequestId !== reelsRequestIdRef.current) return;
        setTotal(j.total || 0);
        setReels((prev) => (reset ? (j.reels || []) : [...prev, ...(j.reels || [])]));
      })
      .finally(() => { if (myRequestId === reelsRequestIdRef.current) setLoading(false); });
  }, [handles, page, sort, minViews, pickedOnly]);

  // reload from page 1 whenever filters/handles/sort change
  useEffect(() => { setPage(1); load(true); }, [handles.join(","), sort, minViews, pickedOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  // fetch next page when page advances past 1
  useEffect(() => { if (page > 1) load(false); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleWinner(url: string, next: boolean) {
    setReels((prev) => prev.map((r) => (r.fields?.["Reel URL"] === url ? { ...r, fields: { ...r.fields, "Is Winner": next } } : r)));
    try {
      const j = await fetch("/api/inspiration-reels/manage", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reel_url: url, is_winner: next }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      onWinnerChange();
    } catch {
      setReels((prev) => prev.map((r) => (r.fields?.["Reel URL"] === url ? { ...r, fields: { ...r.fields, "Is Winner": !next } } : r)));
    }
  }

  async function saveNote(url: string, note: string) {
    setReels((prev) => prev.map((r) => (r.fields?.["Reel URL"] === url ? { ...r, fields: { ...r.fields, Note: note } } : r)));
    await fetch("/api/inspiration-reels/manage", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reel_url: url, note }),
    }).catch(() => {});
  }

  const hasMore = reels.length < total;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Reels</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="number"
            placeholder="min views"
            value={minViews || ""}
            onChange={(e) => setMinViews(Number(e.target.value) || 0)}
            style={{ width: 110 }}
          />
          <button className={pickedOnly ? "" : "secondary"} onClick={() => setPickedOnly((v) => !v)}>⭐ Picked only</button>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="views">Sort: Views</option>
            <option value="posted">Sort: Newest</option>
            <option value="viral">Sort: Viral score</option>
          </select>
          <span className="muted">{total.toLocaleString()} reels</span>
        </div>
      </div>

      {!handles.length ? (
        <div className="muted">Add a profile above to see its reels here.</div>
      ) : loading && !reels.length ? (
        <div style={{ padding: 24 }}><span className="spinner" /> Loading…</div>
      ) : !reels.length ? (
        <div className="muted" style={{ padding: 24 }}>No reels match these filters.</div>
      ) : (
        <>
          <div className="grid-reels">
            {reels.map((rec) => (
              <PickReelCard key={rec.id || rec.fields?.["Reel URL"]} rec={rec} onToggleWinner={toggleWinner} onSaveNote={saveNote} />
            ))}
          </div>
          {hasMore && (
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="secondary" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                {loading ? <><span className="spinner" /> Loading…</> : `Load more (${total - reels.length} left)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PickReelCard({ rec, onToggleWinner, onSaveNote }: { rec: any; onToggleWinner: (url: string, next: boolean) => void; onSaveNote: (url: string, note: string) => void }) {
  const f = rec.fields || {};
  const url = f["Reel URL"];
  const thumb = attachUrl(f.Thumbnail);
  const picked = !!f["Is Winner"];
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(f.Note || "");
  const posted = f["Posted Date"] ? new Date(f["Posted Date"]).toLocaleDateString() : f["Posted At"] ? new Date(f["Posted At"]).toLocaleDateString() : null;

  return (
    <div
      className="reel"
      style={{ position: "relative", border: picked ? "2px solid var(--accent)" : "1px solid var(--border)", boxShadow: picked ? "0 0 0 1px var(--accent)" : "none" }}
    >
      <button
        onClick={() => onToggleWinner(url, !picked)}
        title={picked ? "Picked — click to unpick" : "Pick this reel to copy"}
        style={{
          position: "absolute", top: 8, right: 8, zIndex: 6,
          background: "rgba(0,0,0,.6)", border: "none", borderRadius: 8,
          padding: "3px 9px", fontSize: 17, lineHeight: "20px", cursor: "pointer",
          color: picked ? "#f1c40f" : "#fff",
        }}
      >
        {picked ? "★" : "☆"}
      </button>
      <a href={url} target="_blank" rel="noreferrer" style={{ position: "relative", display: "block" }}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={thumb} alt="" loading="lazy" />
        ) : (
          <div className="thumb placeholder">no thumbnail</div>
        )}
      </a>
      <div className="body">
        <div className="handle">@{f["Author Handle"] || "unknown"}{picked && <span className="badge" style={{ marginLeft: 6, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>Picked</span>}</div>
        <div className="stats">
          <span><b>{fmt(f.Views)}</b> views</span>
          <span>{fmt(f.Likes)} likes</span>
          {posted && <span className="muted">{posted}</span>}
        </div>
        {noteOpen ? (
          <div style={{ marginTop: 6 }}>
            <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Note…" autoFocus style={{ width: "100%", minHeight: 50, fontSize: 12 }} />
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <button style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { onSaveNote(url, noteDraft); setNoteOpen(false); }}>Save</button>
              <button className="secondary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setNoteDraft(f.Note || ""); setNoteOpen(false); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="secondary" onClick={() => setNoteOpen(true)} style={{ fontSize: 11, padding: "3px 8px", marginTop: 6 }}>
            {f.Note ? "📝 Note" : "+ Note"}
          </button>
        )}
      </div>
    </div>
  );
}
