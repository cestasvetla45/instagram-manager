"use client";
import { useEffect, useState } from "react";

type TgUser = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  added_at: string | null;
  added_by: string | null;
};

const ROLE_HELP: Record<string, string> = {
  admin: "Full access — everything the bot can do, plus manage users.",
  content: "Import inspiration, niche recommendations, trending & viral.",
  va: "Account stats, trending & viral only.",
};

export default function TelegramUsersPage() {
  const [users, setUsers] = useState<TgUser[]>([]);
  const [bot, setBot] = useState<{ username: string; name: string } | null>(null);
  const [tid, setTid] = useState("");
  const [role, setRole] = useState("va");
  const [msg, setMsg] = useState("");
  const [forbidden, setForbidden] = useState(false);

  function load() {
    fetch("/api/telegram-users").then((r) => {
      if (r.status === 403 || r.status === 401) { setForbidden(true); return { users: [] }; }
      return r.json();
    }).then((j) => setUsers(j.users || []));
    fetch("/api/telegram/status").then((r) => r.json()).then((j) => setBot(j.bot || null)).catch(() => {});
  }
  useEffect(load, []);

  async function add() {
    const n = Number(tid.trim());
    if (!n || !Number.isFinite(n)) { setMsg("A numeric Telegram ID is required."); return; }
    const res = await fetch("/api/telegram-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: n, role }),
    });
    const j = await res.json();
    if (j.error) setMsg(`Error: ${j.error}`);
    else { setMsg(`Authorized ${n} as ${role}.`); setTid(""); load(); }
  }

  async function deactivate(telegramId: number) {
    if (!confirm(`Deactivate user ${telegramId}?`)) return;
    await fetch(`/api/telegram-users?telegram_id=${telegramId}`, { method: "DELETE" });
    load();
  }

  if (forbidden) return <div><h1 className="h1">Telegram Users</h1><p className="muted">Admins only.</p></div>;

  return (
    <div>
      <h1 className="h1">Telegram Users</h1>
      <p className="sub">
        Authorize team members to use the Telegram bot. Users find their numeric Telegram ID by messaging the bot —
        it replies with their ID if they aren&rsquo;t yet authorized.
      </p>

      {bot && (
        <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>Bot</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>@{bot.username} <span className="muted" style={{ fontWeight: 400 }}>({bot.name})</span></div>
          </div>
          <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            Share bot link ↗
          </a>
        </div>
      )}

      <div className="panel">
        <h2>Authorize a user</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Telegram ID (numeric)" value={tid} onChange={(e) => setTid(e.target.value)} style={{ minWidth: 180 }} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin — full access</option>
            <option value="content">Content — inspiration & recommendations</option>
            <option value="va">VA — stats & trending</option>
          </select>
          <button onClick={add}>Authorize</button>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>{ROLE_HELP[role]}</p>
        {msg && <p className="muted" style={{ marginTop: 6 }}>{msg}</p>}
      </div>

      <div className="panel">
        <h2>Authorized users</h2>
        {users.length === 0 ? <p className="muted">No authorized Telegram users yet.</p> : (
          <table>
            <thead><tr><th>Telegram ID</th><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.id} style={{ opacity: x.is_active ? 1 : 0.5 }}>
                  <td><code>{x.telegram_id}</code></td>
                  <td>{x.username ? "@" + x.username : "—"}</td>
                  <td className="muted">{[x.first_name, x.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td><span className="badge" style={{ background: x.role === "admin" ? "var(--accent)" : "var(--panel-2)", color: x.role === "admin" ? "#fff" : "var(--text)" }}>{x.role}</span></td>
                  <td>{x.is_active ? "🟢 active" : "⏸ inactive"}</td>
                  <td>{x.is_active && <button className="secondary" onClick={() => deactivate(x.telegram_id)} style={{ fontSize: 12, padding: "3px 8px" }}>Deactivate</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
