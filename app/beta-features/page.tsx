"use client";

type Priority = "High" | "Medium" | "Low";

type Feature = {
  title: string;
  desc: string;
  priority: Priority;
};

const PRIORITY_STYLE: Record<Priority, { bg: string; border: string; color: string }> = {
  High: { bg: "#2a1622", border: "var(--accent)", color: "#ffb3cd" },
  Medium: { bg: "#2a2410", border: "var(--warn)", color: "#f7e39b" },
  Low: { bg: "var(--panel-2)", border: "var(--border)", color: "var(--muted)" },
};

const HIGH_PRIORITY: Feature[] = [
  {
    title: "Automated posting infrastructure",
    desc:
      "Post directly to Instagram at scale — via paired physical Android phones driven remotely with team access, cloud phones (Geelark), or official platform APIs (IG/TikTok/YouTube beta). Today we only scrape and track; we can't publish.",
    priority: "High",
  },
  {
    title: "Content repurposing / spoofing engine",
    desc:
      "Auto-generate non-duplicate variants of a single video (metadata and audio spoofing) so the same content can be reposted across many accounts without tripping duplicate-content detection.",
    priority: "High",
  },
  {
    title: "Viral template library + AI template autopilot",
    desc:
      "A library of proven formats (flash countdown, reaction, clipping, trending-audio) that can be picked manually or auto-selected, scored by content fit, virality potential, and past performance.",
    priority: "High",
  },
  {
    title: "Text overlay tooling + analytics",
    desc:
      "Add on-screen text overlays to blank/raw videos, then track which hooks and captions drive views above an account's average — closing the loop between hook copy and performance.",
    priority: "High",
  },
  {
    title: "Account status / reach-limit watcher",
    desc:
      "An hourly automated health check per account and device that auto-pauses posting the moment an account goes 'restricted' — proactive ban protection instead of noticing damage after the fact.",
    priority: "High",
  },
];

const OTHER_IDEAS: Feature[] = [
  {
    title: "Smarter auto-sync",
    desc:
      "A background sync job with a 'Scheduled Sync' mode plus a full per-account sync history and audit log — more hands-off than our current fixed-interval refresh.",
    priority: "Medium",
  },
  {
    title: "Content Manager batch actions",
    desc:
      "Multi-select content items and apply bulk actions (archive, tag, assign) in one pass instead of editing them one at a time.",
    priority: "Medium",
  },
  {
    title: "OF / monetization attribution",
    desc:
      "Per-account trailing links with click and revenue tracking, plus sale notifications, so earnings can be attributed back to the account that drove them.",
    priority: "Medium",
  },
  {
    title: "Proxy / device manager",
    desc:
      "Assign proxies or SIM data per device, profile, or account to support scaled operations across many identities safely.",
    priority: "Medium",
  },
  {
    title: "Primary vs backup account modes",
    desc:
      "Distinct content strategies per account role — unique, low-frequency posts for 'primary' pages versus high-frequency repurposed content for 'backup/farm' pages.",
    priority: "Low",
  },
  {
    title: "Multi-platform distribution",
    desc:
      "Extend posting beyond Instagram to TikTok and YouTube so one piece of content can be distributed everywhere from one place.",
    priority: "Low",
  },
];

function PriorityPill({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLE[priority];
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {priority} priority
    </span>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{f.title}</div>
        <PriorityPill priority={f.priority} />
      </div>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>{f.desc}</p>
      <div style={{ marginTop: "auto", paddingTop: 4 }}>
        <span className="badge">Source: Butter</span>
      </div>
    </div>
  );
}

function Section({ title, features }: { title: string; features: Feature[] }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {features.map((f) => (
          <FeatureCard key={f.title} f={f} />
        ))}
      </div>
    </div>
  );
}

export default function BetaFeatures() {
  return (
    <div>
      <h1 className="h1">Beta Features 🧪</h1>
      <p className="sub">Roadmap &amp; ideas — feature gaps to review and vote on. Not live functionality.</p>

      <div className="banner">
        This list comes from analyzing <b>Butter</b>, a competitor tool, and captures capabilities it has that
        Reel Lab does not yet. It's meant to guide what we build next — review each item and vote on priorities.
        Nothing here is wired up; it's a static planning page.
      </div>

      <Section title="High Priority — Posting & Automation" features={HIGH_PRIORITY} />
      <Section title="Other Ideas" features={OTHER_IDEAS} />
    </div>
  );
}
