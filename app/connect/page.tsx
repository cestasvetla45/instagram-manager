"use client";
import { useEffect, useState, useCallback } from "react";

type Account = {
  id: string;
  ig_username?: string;
  ig_account_id: string;
  follower_count: number;
  connected_at: string;
  last_synced_at?: string;
  token_expires_at?: string;
  is_active: boolean;
};

export default function ConnectPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/instagram-graph/accounts");
      const j = await r.json();
      setAccounts(j.accounts || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("success")) setSuccess(true);
    if (params.get("error")) setError("Connection failed. Please try again.");
  }, [load]);

  async function connect() {
    try {
      const r = await fetch("/api/instagram-graph/connect");
      const j = await r.json();
      if (j.ok && j.url) {
        window.location.href = j.url;
      } else {
        setError("Could not start connection flow.");
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/instagram-graph/sync", { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account?")) return;
    try {
      await fetch("/api/instagram-graph/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function daysLeft(expires?: string): number | null {
    if (!expires) return null;
    const d = new Date(expires).getTime() - Date.now();
    return Math.floor(d / 86400000);
  }

  function timeAgo(iso?: string) {
    if (!iso) return "never";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 500, margin: "0 auto", padding: 20, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 18, color: "#888" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: 20, minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: 32, marginTop: 20 }}>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Reel Lab</div>
        <div style={{ fontSize: 16, color: "#888" }}>Connect your Instagram account</div>
      </div>

      {success && (
        <div style={{ background: "#d4edda", color: "#155724", padding: "16px", borderRadius: 12, marginBottom: 16, fontSize: 15, textAlign: "center" }}>
          ✅ Account connected! Syncing insights now...
        </div>
      )}

      {error && (
        <div style={{ background: "#f8d7da", color: "#721c24", padding: "16px", borderRadius: 12, marginBottom: 16, fontSize: 15, textAlign: "center" }}>
          ⚠️ {error}
        </div>
      )}

      {accounts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          {accounts.map((a) => {
            const days = daysLeft(a.token_expires_at);
            const expiryColor = days === null ? "#888" : days > 7 ? "#28a745" : days > 1 ? "#ffc107" : "#dc3545";
            const initial = (a.ig_username || "?")[0].toUpperCase();
            return (
              <div key={a.id} style={{
                background: "#fff",
                borderRadius: 16,
                padding: 20,
                marginBottom: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid #eee",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: "50%",
                    background: "#6c5ce7", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, fontWeight: 700, flexShrink: 0,
                  }}>{initial}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>@{a.ig_username || "unknown"}</div>
                    <div style={{ fontSize: 13, color: "#888" }}>{a.follower_count?.toLocaleString() || 0} followers</div>
                  </div>
                  <span style={{
                    fontSize: 12, padding: "4px 8px", borderRadius: 6,
                    background: days !== null && days <= 1 ? "#f8d7da" : "transparent",
                    color: expiryColor, fontWeight: 600,
                  }}>
                    {days === null ? "" : days > 0 ? `${days}d left` : "EXPIRED"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#aaa", marginBottom: 12 }}>
                  Connected: {new Date(a.connected_at).toLocaleDateString()} · Last sync: {timeAgo(a.last_synced_at)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={sync} disabled={syncing} style={{
                    flex: 1, padding: "12px", borderRadius: 10,
                    background: "#6c5ce7", color: "#fff", border: "none",
                    fontSize: 14, fontWeight: 600, cursor: syncing ? "wait" : "pointer",
                  }}>{syncing ? "Syncing..." : "Sync Now"}</button>
                  <button onClick={() => disconnect(a.id)} style={{
                    padding: "12px 16px", borderRadius: 10,
                    background: "transparent", color: "#dc3545", border: "1px solid #dc3545",
                    fontSize: 14, fontWeight: 600, cursor: "pointer",
                  }}>Disconnect</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={connect} style={{
        width: "100%", padding: "18px", borderRadius: 14,
        background: accounts.length > 0 ? "#fff" : "#6c5ce7",
        color: accounts.length > 0 ? "#6c5ce7" : "#fff",
        border: accounts.length > 0 ? "2px solid #6c5ce7" : "none",
        fontSize: 18, fontWeight: 700, cursor: "pointer",
        boxShadow: accounts.length > 0 ? "none" : "0 4px 12px rgba(108,92,231,0.3)",
      }}>
        {accounts.length > 0 ? "+ Connect Another Account" : "Connect Instagram Account"}
      </button>

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#aaa" }}>
        You'll be redirected to Facebook to log in
      </div>
    </div>
  );
}
