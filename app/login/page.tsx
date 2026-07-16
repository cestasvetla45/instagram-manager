"use client";
import { useState } from "react";

export default function LoginPage() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      const j = await res.json();
      if (j.error) {
        setErr(j.error);
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = j.role === "va" ? "/va" : next && !next.startsWith("/login") ? next : "/";
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={submit} className="panel" style={{ width: 340, maxWidth: "90vw" }}>
        <h1 className="h1" style={{ marginTop: 0 }}>Reel Lab</h1>
        <p className="sub">Sign in to continue.</p>
        <input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} autoFocus style={{ width: "100%", marginBottom: 10 }} />
        <input placeholder="Password" type="password" value={p} onChange={(e) => setP(e.target.value)} style={{ width: "100%", marginBottom: 14 }} />
        {err && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 0 }}>{err}</p>}
        <button type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? <><span className="spinner" /> Signing in…</> : "Sign in"}
        </button>
      </form>
    </div>
  );
}
