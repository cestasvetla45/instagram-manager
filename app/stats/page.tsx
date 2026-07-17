"use client";
import { useEffect, useState, useCallback } from "react";

type Reel = {
  id: string;
  reel_url: string;
  shortcode: string;
  account_handle: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  posted_at: string;
  thumbnail_url: string;
  updated_at: string;
};

export default function StatsInputPage() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((j) => {
        const handles = (j.accounts || j || []).map((a: any) => a.handle).filter(Boolean);
        setAccounts(handles);
      })
      .catch(() => {});
  }, []);

  const loadReels = useCallback(async (handle: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/reels?type=our&handle=${handle}&limit=50`);
      const j = await r.json();
      setReels(j.records || j.reels || []);
    } catch {
      setReels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccount) loadReels(selectedAccount);
  }, [selectedAccount, loadReels]);

  async function saveReel(reel: Reel, updated: Partial<Reel>) {
    try {
      const r = await fetch("/api/reels/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reel_url: reel.reel_url,
          ...updated,
        }),
      });
      if (r.ok) {
        setReels((prev) => prev.map((r) => (r.reel_url === reel.reel_url ? { ...r, ...updated } : r)));
        setEditing(null);
        setMsg("✅ Saved");
        setTimeout(() => setMsg(""), 2000);
      } else {
        setMsg("❌ Failed to save");
      }
    } catch {
      setMsg("❌ Error");
    }
  }

  function fmt(n: number) {
    return Number(n || 0).toLocaleString();
  }

  function timeAgo(iso: string) {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 16, fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", marginBottom: 24, marginTop: 12 }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>📊 Stats Input</div>
        <div style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Update reel stats manually</div>
      </div>

      {msg && (
        <div style={{ background: "#d4edda", color: "#155724", padding: 12, borderRadius: 10, marginBottom: 12, textAlign: "center", fontSize: 14 }}>
          {msg}
        </div>
      )}

      {/* Account selector */}
      <div style={{ marginBottom: 16 }}>
        <select
          value={selectedAccount}
          onChange={(e) => setSelectedAccount(e.target.value)}
          style={{ width: "100%", padding: "14px", borderRadius: 12, fontSize: 16, border: "1px solid #ddd", background: "#fff" }}
        >
          <option value="">Select account…</option>
          {accounts.map((h) => (
            <option key={h} value={h}>@{h}</option>
          ))}
        </select>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 20, color: "#888" }}>Loading reels…</div>}

      {/* Reels list */}
      {reels.map((reel) => (
        <div key={reel.id} style={{
          background: "#fff", borderRadius: 14, padding: 16, marginBottom: 12,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #eee",
        }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            {reel.thumbnail_url ? (
              <img src={reel.thumbnail_url} alt="" style={{ width: 72, height: 128, borderRadius: 8, objectFit: "cover" }} loading="lazy" />
            ) : (
              <div style={{ width: 72, height: 128, borderRadius: 8, background: "#f0f0f0" }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>
                {reel.posted_at ? new Date(reel.posted_at).toLocaleDateString() : "—"} · {timeAgo(reel.updated_at)} ago
              </div>
              <div style={{ fontSize: 13, color: "#555", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {reel.caption || "No caption"}
              </div>
              <a href={reel.reel_url} target="_blank" rel="noopener" style={{ fontSize: 12, color: "#6c5ce7", textDecoration: "none" }}>View on IG →</a>
            </div>
          </div>

          {editing === reel.reel_url ? (
            <EditForm reel={reel} onSave={(updated) => saveReel(reel, updated)} onCancel={() => setEditing(null)} />
          ) : (
            <div onClick={() => setEditing(reel.reel_url)} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, cursor: "pointer" }}>
              <Stat label="Views" value={fmt(reel.views)} />
              <Stat label="Likes" value={fmt(reel.likes)} />
              <Stat label="Comments" value={fmt(reel.comments)} />
              <Stat label="Shares" value={fmt(reel.shares)} />
              <Stat label="Saves" value={fmt(reel.saves)} />
            </div>
          )}
        </div>
      ))}

      {!loading && selectedAccount && reels.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#888" }}>No reels found for this account.</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#aaa", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function EditForm({ reel, onSave, onCancel }: { reel: Reel; onSave: (v: Partial<Reel>) => void; onCancel: () => void }) {
  const [views, setViews] = useState(String(reel.views || ""));
  const [likes, setLikes] = useState(String(reel.likes || ""));
  const [comments, setComments] = useState(String(reel.comments || ""));
  const [shares, setShares] = useState(String(reel.shares || ""));
  const [saves, setSaves] = useState(String(reel.saves || ""));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Input label="Views" value={views} onChange={setViews} />
        <Input label="Likes" value={likes} onChange={setLikes} />
        <Input label="Comments" value={comments} onChange={setComments} />
        <Input label="Shares" value={shares} onChange={setShares} />
        <Input label="Saves" value={saves} onChange={setSaves} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSave({ views: +views || 0, likes: +likes || 0, comments: +comments || 0, shares: +shares || 0, saves: +saves || 0 })}
          style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#6c5ce7", color: "#fff", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Save
        </button>
        <button onClick={onCancel} style={{ padding: "12px 16px", borderRadius: 10, background: "transparent", color: "#666", border: "1px solid #ddd", fontSize: 15, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 15, boxSizing: "border-box" }} />
    </div>
  );
}
