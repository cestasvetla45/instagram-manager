"use client";
import { useEffect, useState } from "react";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [role, setRole] = useState("va");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/users").then((r) => {
      if (r.status === 403 || r.status === 401) { setForbidden(true); return { users: [] }; }
      return r.json();
    }).then((j) => { setUsers(j.users || []); setLoading(false); });
  }
  useEffect(load, []);

  async function add() {
    if (!u.trim() || p.length < 6) { setMsg("Username + 6+ char password required."); return; }
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p, role, label }),
    });
    const j = await res.json();
    if (j.error) setMsg(`Error: ${j.error}`);
    else { setMsg(`Added @${u}. Share their username + password with them.`); setU(""); setP(""); setLabel(""); load(); }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    await fetch(`/api/users?id=${id}`, { method: "DELETE" });
    load();
  }

  if (forbidden) return <div><h1 className="h1">Users</h1><p className="muted">Admins only.</p></div>;

  return (
    <div>
      <h1 className="h1">Users &amp; access</h1>
      <p className="sub">Create logins for your team. <b>Admin</b> = full access. <b>VA</b> = VA Daily + vault only.</p>

      <div className="panel">
        <h2>Add a user</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="username" value={u} onChange={(e) => setU(e.target.value)} style={{ minWidth: 150 }} />
          <input placeholder="password (6+ chars)" type="text" value={p} onChange={(e) => setP(e.target.value)} style={{ minWidth: 170 }} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin — full access</option>
            <option value="va">VA — VA Daily only</option>
          </select>
          <input placeholder="name / note (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ minWidth: 150 }} />
          <button onClick={add}>Add user</button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 10 }}>{msg}</p>}
      </div>

      <div className="panel">
        <h2>Team</h2>
        {loading ? <p className="muted"><span className="spinner" /> Loading…</p> : users.length === 0 ? <p className="muted">No users yet (the root admin from your Railway env isn&rsquo;t listed here).</p> : (
          <table>
            <thead><tr><th>Username</th><th>Role</th><th>Name</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {users.map((x) => (
                <tr key={x.id}>
                  <td>@{x.username}</td>
                  <td><span className="badge" style={{ background: x.role === "admin" ? "var(--accent)" : "var(--panel-2)", color: x.role === "admin" ? "#fff" : "var(--text)" }}>{x.role}</span></td>
                  <td className="muted">{x.label || "—"}</td>
                  <td className="muted">{x.created_at ? new Date(x.created_at).toLocaleDateString() : ""}</td>
                  <td><button className="secondary" onClick={() => remove(x.id, x.username)} style={{ fontSize: 12, padding: "3px 8px" }}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
