"use client";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "📊 Overview",
    items: [
      { href: "/", label: "Overview" },
      { href: "/dashboard", label: "Accounts Dashboard" },
      { href: "/growth", label: "Growth" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
  {
    label: "🎯 Inspiration",
    items: [
      { href: "/inspiration-library", label: "Inspiration Library" },
      { href: "/inspiration-accounts", label: "Inspiration Accounts" },
      { href: "/inspiration", label: "Inspiration Reels" },
      { href: "/generate", label: "Inspiration Generator" },
      { href: "/discovery", label: "Creator Discovery" },
      { href: "/top-reels", label: "Top Reels" },
      { href: "/comments", label: "Comment Intelligence" },
    ],
  },
  {
    label: "🎬 Content",
    items: [
      { href: "/pipeline", label: "Content Pipeline" },
      { href: "/vault", label: "Content Vault" },
      { href: "/add", label: "Add / Scrape" },
    ],
  },
  {
    label: "📋 Accounts",
    items: [
      { href: "/our-reels", label: "Our Reels" },
      { href: "/performance", label: "Reel Performance" },
      { href: "/va-management", label: "VA Management" },
      { href: "/va", label: "VA Daily" },
    ],
  },
  {
    label: "⚙️ Settings",
    items: [
      { href: "/admin", label: "Admin Dashboard" },
      { href: "/users", label: "Users & Access" },
      { href: "/telegram", label: "Telegram Bot" },
      { href: "/telegram-users", label: "Telegram Users" },
      { href: "/beta-features", label: "Beta Features 🧪" },
    ],
  },
];

// Flat list of every nav item — used for search.
const ALL_LINKS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

// Extra searchable sub-sections / tools (not their own nav item).
const TOOLS = [
  { href: "/pipeline", label: "Pipeline — create concepts from reels", kw: "brief concept content type subniche assign cooldown" },
  { href: "/pipeline", label: "Assign briefs to accounts", kw: "assign va post pipeline" },
  { href: "/pipeline", label: "VA posting view", kw: "available cooldown ready post" },
  { href: "/pipeline", label: "Push briefs to Airtable", kw: "airtable sync generate photos" },
  { href: "/vault", label: "Vault — carousels / reels / posts", kw: "carousel reel post story prepare stage media library assets content" },
  { href: "/va", label: "Story vault (VA)", kw: "story images stories" },
  { href: "/va", label: "Post / story log", kw: "log links monitor performance" },
  { href: "/va", label: "Daily schedule", kw: "routine times schedule us audience" },
  { href: "/inspiration", label: "Scrape account", kw: "import bulk profiles accounts" },
  { href: "/discovery", label: "Find new creators", kw: "trending discover suggestions candidates mentions collabs commenters auto" },
  { href: "/inspiration", label: "AI auto-categorize", kw: "gemini niche tag video" },
  { href: "/inspiration", label: "Add reels to a niche", kw: "paste reels" },
  { href: "/users", label: "Logins & roles", kw: "team admin va permissions access password" },
  { href: "/telegram-users", label: "Telegram team access", kw: "bot authorize telegram member va content role" },
];

const COLLAPSE_KEY = "sidebar_collapsed_groups";

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => {
      setRole(j.role || null);
      setUsername(j.username || null);
      setAuthEnabled(!!j.authEnabled);
    }).catch(() => {});
  }, []);

  // Restore collapsed groups from localStorage (client-only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {}
  }, []);

  function toggleGroup(label: string) {
    setCollapsed((prev) => {
      const next = prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label];
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const isVa = role === "va";
  // VAs only see VA Daily + the Telegram bot page; the /users admin page is
  // admin-only. Everything else is visible to admins.
  const allowed = (href: string) =>
    isVa ? href === "/va" || href === "/telegram" : href !== "/users" || role === "admin";

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((l) => allowed(l.href)) })).filter((g) => g.items.length),
    [role]
  );

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const pool = [
      ...ALL_LINKS.map((l) => ({ href: l.href, label: l.label, kw: "" })),
      ...TOOLS,
    ].filter((e) => allowed(e.href));
    return pool
      .filter((e) => e.label.toLowerCase().includes(s) || e.kw.toLowerCase().includes(s) || e.href.includes(s))
      .slice(0, 10);
  }, [q, role]);

  function go(href: string) {
    setQ("");
    router.push(href);
  }

  if (path === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="sidebar">
      <div className="brand">Reel Lab</div>
      <div className="brand-sub">Instagram manager</div>

      <input
        placeholder="🔍 Search sections & tools…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && results[0]) go(results[0].href); if (e.key === "Escape") setQ(""); }}
        style={{ width: "100%", margin: "12px 0 6px", fontSize: 13 }}
      />

      <nav className="nav">
        {q.trim() ? (
          results.length ? (
            results.map((r, i) => (
              <a key={i} onClick={() => go(r.href)} style={{ cursor: "pointer" }}>{r.label}</a>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>No matches</div>
          )
        ) : (
          groups.map((g) => {
            const isCollapsed = collapsed.includes(g.label);
            return (
              <div key={g.label} style={{ marginBottom: 6 }}>
                <div
                  onClick={() => toggleGroup(g.label)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    color: "var(--muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "8px 4px 6px",
                    marginTop: 6,
                    borderBottom: "1px solid var(--border)",
                    userSelect: "none",
                  }}
                >
                  <span>{g.label}</span>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{isCollapsed ? "▶" : "▼"}</span>
                </div>
                {!isCollapsed &&
                  g.items.map((l) => (
                    <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
                      {l.label}
                    </Link>
                  ))}
              </div>
            );
          })
        )}
      </nav>

      {authEnabled && username && (
        <div style={{ marginTop: "auto", paddingTop: 16, fontSize: 12 }}>
          <div className="muted" style={{ marginBottom: 6 }}>@{username} · {role}</div>
          <button className="secondary" onClick={logout} style={{ fontSize: 12, padding: "4px 10px" }}>Log out</button>
        </div>
      )}
    </aside>
  );
}
