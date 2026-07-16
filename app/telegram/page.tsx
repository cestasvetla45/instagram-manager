"use client";
import { useEffect, useState } from "react";

type Status = {
  configured: boolean;
  bot?: { username: string; name: string } | null;
  webhook?: { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number } | null;
  error?: string;
};

const COMMANDS: [string, string][] = [
  ["/stats", "Your account stats (followers, views, reels today)"],
  ["/stats @handle", "Stats for a specific account"],
  ["/inspire", "Send reel links or @handles to bulk-import inspiration"],
  ["/niche", "What niche should you do next? (data-driven)"],
  ["/trending", "Top viral reels right now"],
  ["/viral", "Fresh viral from the last 24h"],
  ["/library", "Inspiration library stats (reels, niches, trays)"],
  ["/adduser <id> <role>", "Admin — authorize a user (admin/content/va)"],
  ["/users", "Admin — list authorized users"],
  ["/removeuser <id>", "Admin — deactivate a user"],
];

export default function TelegramPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/telegram/status");
      setStatus(await r.json());
    } catch (e: any) {
      setStatus({ configured: false, error: e?.message || String(e) });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function reregister() {
    setRegistering(true);
    setMsg("");
    try {
      const r = await fetch("/api/telegram/setup");
      const j = await r.json();
      setMsg(j.ok ? `✅ Webhook registered: ${j.webhook_url}` : `❌ ${j.error || "failed"}`);
      await load();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || String(e)}`);
    }
    setRegistering(false);
  }

  const bot = status?.bot;
  const webhook = status?.webhook;
  const registered = Boolean(webhook?.url);

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ marginBottom: 4 }}>🤖 Telegram Bot</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Control the Instagram Manager from Telegram — stats, imports, and niche recommendations.
      </p>

      {/* Status card */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
          marginTop: 16,
        }}
      >
        {loading ? (
          <div style={{ color: "var(--muted)" }}>Loading…</div>
        ) : !status?.configured ? (
          <div style={{ color: "var(--warn)" }}>
            ⚠️ TELEGRAM_BOT_TOKEN is not set on this deployment. Add it in Railway and redeploy.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <Row label="Bot">
              {bot ? (
                <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  @{bot.username} ({bot.name})
                </a>
              ) : (
                <span style={{ color: "var(--muted)" }}>unknown</span>
              )}
            </Row>
            <Row label="Webhook">
              <span style={{ color: registered ? "var(--ok, #7CFFB2)" : "var(--warn)" }}>
                {registered ? "🟢 registered" : "🔴 not registered"}
              </span>
            </Row>
            {webhook?.url && (
              <Row label="URL">
                <code style={{ fontSize: 12, wordBreak: "break-all" }}>{webhook.url}</code>
              </Row>
            )}
            <Row label="Pending updates">{webhook?.pending_update_count ?? 0}</Row>
            {webhook?.last_error_message && (
              <Row label="Last error">
                <span style={{ color: "var(--warn)" }}>{webhook.last_error_message}</span>
              </Row>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={reregister}
            disabled={registering}
            style={{
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              cursor: registering ? "default" : "pointer",
              opacity: registering ? 0.6 : 1,
            }}
          >
            {registering ? "Registering…" : "Re-register webhook"}
          </button>
          {bot && (
            <a
              href={`https://t.me/${bot.username}`}
              target="_blank"
              rel="noreferrer"
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 16px",
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              Open in Telegram ↗
            </a>
          )}
        </div>
        {msg && <div style={{ marginTop: 12, fontSize: 13 }}>{msg}</div>}
      </div>

      {/* Command reference */}
      <h2 style={{ marginTop: 28, marginBottom: 8 }}>Commands</h2>
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {COMMANDS.map(([cmd, desc], i) => (
          <div
            key={cmd}
            style={{
              display: "flex",
              gap: 16,
              padding: "12px 16px",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <code style={{ minWidth: 140, color: "var(--accent)" }}>{cmd}</code>
            <span style={{ color: "var(--muted)" }}>{desc}</span>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
        You can also just paste Instagram reel links or @handles directly — the bot will walk you through tray, niche, and
        sub-category before importing.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ minWidth: 130, color: "var(--muted)" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
