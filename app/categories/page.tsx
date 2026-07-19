"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmt } from "../components/util";
import ConfigBanner from "../components/ConfigBanner";

type Category = {
  id: string;
  name: string;
  slug: string;
  profile_count: number;
  reel_count: number;
  total_views: number;
  avg_views: number;
  picked_count: number;
  preview: { thumbnail_url: string | null; reel_url: string }[];
};

export default function CategoriesHubPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // The aggregate query scans every reel and can take a few seconds. If two
  // loads overlap (e.g. a quick hub -> detail -> hub round trip re-mounts
  // this page while an older fetch is still in flight), only the response
  // from the most-recently-started request may update state — otherwise a
  // stale response finishing last could clobber fresher data.
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    fetch("/api/categories")
      .then((r) => r.json())
      .then((j) => {
        if (myRequestId !== requestIdRef.current) return; // superseded by a newer load()
        if (j.error) throw new Error(j.error);
        setCategories(j.categories || []);
      })
      .catch((e) => { if (myRequestId === requestIdRef.current) setMsg(`Error: ${e.message || e}`); })
      .finally(() => { if (myRequestId === requestIdRef.current) setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCategory() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const j = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setNewName("");
      setShowNew(false);
      load();
    } catch (e: any) {
      setMsg(`Error: ${e.message || e}`);
    } finally {
      setCreating(false);
    }
  }

  async function renameCategory(oldName: string, newNameVal: string) {
    if (!newNameVal.trim() || newNameVal.trim() === oldName) return;
    try {
      const j = await fetch(`/api/categories/${encodeURIComponent(oldName)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newName: newNameVal.trim() }),
      }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      load();
    } catch (e: any) {
      setMsg(`Rename failed: ${e.message || e}`);
    }
  }

  async function deleteCategory(cat: Category) {
    if (cat.profile_count > 0) {
      setMsg(`"${cat.name}" still has ${cat.profile_count} profile(s) — reassign them to another category first.`);
      return;
    }
    if (!confirm(`Delete category "${cat.name}"? This cannot be undone.`)) return;
    try {
      const j = await fetch(`/api/categories/${encodeURIComponent(cat.name)}`, { method: "DELETE" }).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setMsg(`Deleted "${cat.name}".`);
      load();
    } catch (e: any) {
      setMsg(`Delete failed: ${e.message || e}`);
    }
  }

  return (
    <div>
      <h1 className="h1">Categories</h1>
      <p className="sub">Pick a niche, add profiles, then open it up and pick out reels you want to copy.</p>
      <ConfigBanner />

      <div className="row" style={{ gap: 8, marginBottom: 16, alignItems: "center" }}>
        {showNew ? (
          <>
            <input
              autoFocus
              placeholder="e.g. no arms, goth, tall girl…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCategory();
                if (e.key === "Escape") { setShowNew(false); setNewName(""); }
              }}
              style={{ minWidth: 220 }}
            />
            <button onClick={createCategory} disabled={creating || !newName.trim()}>
              {creating ? <><span className="spinner" /> Creating…</> : "Create"}
            </button>
            <button className="secondary" onClick={() => { setShowNew(false); setNewName(""); }}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setShowNew(true)}>+ New Category</button>
        )}
        <div style={{ marginLeft: "auto" }} className="muted">{categories.length} categor{categories.length === 1 ? "y" : "ies"}</div>
      </div>

      {msg && (
        <div className="banner" style={{ marginBottom: 16 }}>
          {msg} <button className="secondary" style={{ marginLeft: 10, fontSize: 11, padding: "2px 8px" }} onClick={() => setMsg("")}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24 }}><span className="spinner" /> Loading…</div>
      ) : categories.length === 0 ? (
        <div className="panel muted">No categories yet. Create one above — "no arms", "goth", "tall", whatever niche you're chasing.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {categories.map((c) => (
            <CategoryCard key={c.id} cat={c} onRename={renameCategory} onDelete={deleteCategory} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryCard({ cat, onRename, onDelete }: { cat: Category; onRename: (oldName: string, newName: string) => void; onDelete: (cat: Category) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  // Guards against commitRename firing twice: pressing Enter unmounts the
  // input (swapped back to the Link), and the browser's own blur-on-unmount
  // then re-fires the onBlur handler with a stale `cat.name` closure.
  const committedRef = useRef(false);

  useEffect(() => { if (!editing) setDraft(cat.name); }, [cat.name, editing]);

  function startEditing() {
    committedRef.current = false;
    setEditing(true);
  }

  function commitRename() {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    onRename(cat.name, draft);
  }

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { committedRef.current = true; setDraft(cat.name); setEditing(false); }
            }}
            style={{ fontSize: 17, fontWeight: 700, flex: 1 }}
          />
        ) : (
          <Link href={`/categories/${encodeURIComponent(cat.name)}`} style={{ fontSize: 18, fontWeight: 700 }}>
            {cat.name}
          </Link>
        )}
      </div>

      <PreviewStrip preview={cat.preview} name={cat.name} />

      <div className="row" style={{ gap: 14, fontSize: 13, flexWrap: "wrap" }}>
        <span><b>{cat.profile_count}</b> <span className="muted">profile{cat.profile_count === 1 ? "" : "s"}</span></span>
        <span><b>{cat.reel_count}</b> <span className="muted">reels</span></span>
        <span><b>{fmt(cat.total_views)}</b> <span className="muted">views</span></span>
        <span><b>{fmt(cat.avg_views)}</b> <span className="muted">avg</span></span>
      </div>
      <div style={{ fontSize: 13 }} className={cat.picked_count ? "" : "muted"}>
        ⭐ {cat.picked_count} picked of {cat.reel_count}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <Link href={`/categories/${encodeURIComponent(cat.name)}`} style={{ flex: 1 }}>
          <button style={{ width: "100%" }}>Open</button>
        </Link>
        <button className="secondary" onClick={startEditing} style={{ fontSize: 12, padding: "6px 10px" }}>Rename</button>
        <button
          className="secondary"
          onClick={() => onDelete(cat)}
          title={cat.profile_count > 0 ? "Reassign profiles first" : "Delete category"}
          style={{ fontSize: 12, padding: "6px 10px", color: "#e74c3c", borderColor: "#e74c3c" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function PreviewStrip({ preview, name }: { preview: { thumbnail_url: string | null; reel_url: string }[]; name: string }) {
  if (!preview?.length) {
    return (
      <div style={{ height: 90, borderRadius: 10, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center" }} className="muted">
        no reels yet
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 6, flexWrap: "nowrap", overflow: "hidden" }}>
      {preview.map((r, i) => (
        <a key={i} href={r.reel_url} target="_blank" rel="noreferrer" style={{ flex: "1 1 0", minWidth: 0 }} title={`Top reel in ${name}`}>
          {r.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumbnail_url} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 8, display: "block" }} />
          ) : (
            <div style={{ width: "100%", aspectRatio: "9/16", borderRadius: 8, background: "var(--panel-2)" }} />
          )}
        </a>
      ))}
    </div>
  );
}
