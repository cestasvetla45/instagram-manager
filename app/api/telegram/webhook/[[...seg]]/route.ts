import { NextRequest, NextResponse } from "next/server";
import { db, TABLES } from "@/lib/db";
import {
  sendMessage,
  sendPhoto,
  editMessageText,
  answerCallbackQuery,
  telegramConfigured,
  appBaseUrl,
  inlineKeyboard,
  buttonGrid,
  internalHeaders,
  getFile,
  fileDownloadUrl,
  InlineButton,
} from "@/lib/telegram";
import { storeScreenshot } from "@/lib/storage";
import { scrapeProfile } from "@/lib/rocksolid";
import { generateResponse } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────
//  Telegram webhook. Handles commands + a stateful import flow.
//  Pending imports live in an in-memory Map keyed by chat id.
//  This resets on deploy, which is fine — an incomplete flow can
//  simply be restarted by sending the links again.
// ─────────────────────────────────────────────────────────────

type Pending = { text: string; tray?: string; niche?: string };
// globalThis keeps the Map alive across hot reloads in dev.
const g = globalThis as any;
const pending: Map<number, Pending> = g.__tgPending || (g.__tgPending = new Map());

// Pending reel-analytics screenshot waiting for the VA to say which reel it
// belongs to. Keyed by chat id. Resets on deploy — the VA just re-sends.
type PhotoPending = {
  screenshotUrl: string;
  reels: { reel_url: string; account_handle: string }[];
};
const photoPending: Map<number, PhotoPending> =
  g.__tgPhotoPending || (g.__tgPhotoPending = new Map());

const SKIP = "__skip__";
const TRAYS = ["spam", "regular", "pipeline"];

// ---------- small helpers ----------
function fmtNum(n: number): string {
  n = Number(n || 0);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "K";
  return String(n);
}

function secretOk(req: NextRequest, seg: string[] | undefined): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret) return true; // no secret configured → open
  const header = req.headers.get("x-telegram-bot-api-secret-token") || "";
  const pathSecret = seg && seg.length ? seg[seg.length - 1] : "";
  return header === secret || pathSecret === secret;
}

// Detect messages that should trigger the import flow.
function looksLikeImport(text: string): boolean {
  return /instagram\.com/i.test(text) || /(^|\s)@[A-Za-z0-9._]{2,30}/.test(text);
}

// ---------- niche / sub-category option loaders ----------
async function loadNiches(): Promise<string[]> {
  try {
    const { data } = await db().from("niches").select("name").order("name").limit(24);
    return (data || []).map((n: any) => n.name).filter(Boolean);
  } catch {
    return [];
  }
}

async function loadSubCategories(): Promise<string[]> {
  try {
    const { data } = await db().from("sub_categories").select("name").order("sort_order").limit(24);
    return (data || []).map((s: any) => s.name).filter(Boolean);
  } catch {
    return [];
  }
}

// Build inline buttons from a list of option values under a callback prefix.
function optionButtons(prefix: string, values: string[]): InlineButton[][] {
  const btns: InlineButton[] = values
    .filter((v) => `${prefix}:${v}`.length <= 60) // callback_data limit is 64 bytes
    .slice(0, 12)
    .map((v) => ({ text: v, callback_data: `${prefix}:${v}` }));
  btns.push({ text: "⏭ Skip", callback_data: `${prefix}:${SKIP}` });
  return buttonGrid(btns, 2);
}

// ─────────────────────────────────────────────────────────────
//  Authorization — restrict the bot to team members.
//  A user is authorized if they exist in telegram_users with
//  is_active = true. The env-configured admin is auto-created on
//  first contact.  Roles gate which commands each user can run.
// ─────────────────────────────────────────────────────────────

type Auth = { ok: boolean; role: string };
type TgFrom = { id?: number; username?: string; first_name?: string; last_name?: string };

// Which roles may run each command. Commands absent here are open to
// any authorized user (e.g. /start, /help).
const COMMAND_ROLES: Record<string, string[]> = {
  "/stats": ["admin", "va"],
  "/inspire": ["admin", "content"],
  "/niche": ["admin", "content"],
  "/trending": ["admin", "content", "va"],
  "/viral": ["admin", "content", "va"],
  "/library": ["admin", "content"],
  "/perf": ["admin", "content", "va"],
  "/winners": ["admin", "content", "va"],
  "/feedback": ["admin", "content", "va"],
  "/adduser": ["admin"],
  "/users": ["admin"],
  "/removeuser": ["admin"],
  "/posted": ["admin", "va"],
  "/viralaccounts": ["admin", "content", "va"],
  "/vaccounts": ["admin", "content", "va"],
  "/niches": ["admin", "content", "va"],
  "/vacheck": ["admin"],
  "/checkvas": ["admin"],
  "/banned": ["admin"],
  "/checkaccounts": ["admin"],
  "/notifybans": ["admin"],
  "/assign": ["admin"],
  "/unassign": ["admin"],
  "/vas": ["admin"],
  "/schedule": ["admin", "va"],
  "/syncmembers": ["admin"],
};

// Roles that may run the paste-links import flow.
const IMPORT_ROLES = ["admin", "content"];

async function isAuthorized(telegramId: number, from?: TgFrom): Promise<Auth> {
  try {
    const { data } = await db()
      .from("telegram_users")
      .select("role, is_active")
      .eq("telegram_id", telegramId)
      .limit(1);
    if (data?.[0]?.is_active) return { ok: true, role: (data[0] as any).role || "va" };
  } catch (e) {
    console.error("isAuthorized lookup failed:", e);
  }

  const adminId = Number(process.env.TELEGRAM_ADMIN_ID || 0);
  if (adminId && telegramId === adminId) {
    try {
      await db().from("telegram_users").upsert(
        {
          telegram_id: telegramId,
          username: from?.username || null,
          first_name: from?.first_name || null,
          last_name: from?.last_name || null,
          role: "admin",
          is_active: true,
          added_by: "auto-admin",
        },
        { onConflict: "telegram_id" }
      );
    } catch (e) {
      console.error("auto-admin insert failed:", e);
    }
    return { ok: true, role: "admin" };
  }

  return { ok: false, role: "" };
}

function unauthorizedMessage(telegramId: number): string {
  return (
    `🚫 Not authorized. Your Telegram ID is \`${telegramId}\`.\n` +
    `Ask the admin to add you with: \`/adduser ${telegramId} va\``
  );
}

// ─────────────────────────────────────────────────────────────
//  Command handlers
// ─────────────────────────────────────────────────────────────

function helpFor(role: string): string {
  const admin = role === "admin";
  const content = role === "content";
  const va = role === "va";
  const lines = ["🤖 *Reel Lab Bot*", ""];
  if (admin || va) {
    lines.push("/stats — Your account stats (followers, views, growth)");
    lines.push("/stats @handle — Stats for a specific account");
    lines.push("/posted — Check which accounts posted today (add @handle for 7-day history)");
  }
  if (admin || content) {
    lines.push("/inspire — Send reel links or @handles to bulk-import inspiration");
    lines.push("/niche — What niche should you do next? (data-driven)");
  }
  lines.push("/trending — Top viral reels right now");
  lines.push("/viral — Fresh viral from last 24h");
  lines.push("/viralaccounts — Which of your accounts have viral content");
  lines.push("/niches — Top viral niches right now");
  if (admin || content) lines.push("/library — Inspiration library stats (reel count, niches, trays)");
  lines.push("/perf — Recent reel performance (add @handle for one account)");
  lines.push("/winners — Current winning reel templates");
  lines.push("/feedback <reel_url> — AI feedback for a specific reel");
  lines.push("📸 Send an analytics screenshot to attach it to a posted reel");
  if (admin) {
    lines.push("", "*Admin*");
    lines.push("/adduser <telegram_id> <role> — Authorize a user (admin/content/va)");
    lines.push("/users — List authorized users");
    lines.push("/removeuser <telegram_id> — Deactivate a user");
    lines.push("/vacheck — Did VAs do their job today?");
    lines.push("/banned — Check if any accounts are banned/inaccessible");
    lines.push("/notifybans — Toggle auto ban notifications");
    lines.push("/vas — List VAs and their assigned accounts");
    lines.push("/syncmembers — Sync TeamFlow members into the VA system");
    lines.push("/assign <account_handle> <va_name> — Assign an account to a VA");
    lines.push("/unassign <account_handle> — Unassign an account");
    lines.push("/schedule <account_handle> — Show an account's posting schedule");
  }
  if (admin || content) {
    lines.push("", "Or just send me Instagram reel links or @handles directly!");
  }
  return lines.join("\n");
}

async function cmdHelp(chatId: number, role: string) {
  await sendMessage(chatId, helpFor(role), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// ---------- admin: manage authorized users ----------
async function cmdAddUser(chatId: number, arg: string, from?: TgFrom) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const tid = Number(parts[0]);
  const role = (parts[1] || "va").toLowerCase();
  if (!tid || !Number.isFinite(tid)) {
    return sendMessage(chatId, "Usage: `/adduser <telegram_id> <role>`\nRoles: admin, content, va", { parse_mode: "Markdown" });
  }
  if (!["admin", "content", "va"].includes(role)) {
    return sendMessage(chatId, "Invalid role. Use one of: admin, content, va.");
  }
  const { error } = await db().from("telegram_users").upsert(
    { telegram_id: tid, role, is_active: true, added_by: String(from?.username || from?.id || "admin") },
    { onConflict: "telegram_id" }
  );
  if (error) return sendMessage(chatId, `❌ ${error.message}`);
  return sendMessage(chatId, `✅ Authorized \`${tid}\` as *${role}*.`, { parse_mode: "Markdown" });
}

async function cmdListUsers(chatId: number) {
  const { data } = await db()
    .from("telegram_users")
    .select("telegram_id, username, first_name, role, is_active")
    .order("added_at");
  if (!data?.length) return sendMessage(chatId, "No authorized users yet.");
  const lines = ["👥 *Authorized Users*", ""];
  for (const u of data as any[]) {
    const status = u.is_active ? "🟢" : "⏸";
    const name = u.username ? "@" + u.username : u.first_name || "—";
    lines.push(`${status} \`${u.telegram_id}\` — ${name} · *${u.role}*`);
  }
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

async function cmdRemoveUser(chatId: number, arg: string) {
  const tid = Number(arg.trim());
  if (!tid || !Number.isFinite(tid)) {
    return sendMessage(chatId, "Usage: `/removeuser <telegram_id>`", { parse_mode: "Markdown" });
  }
  const { error } = await db().from("telegram_users").update({ is_active: false }).eq("telegram_id", tid);
  if (error) return sendMessage(chatId, `❌ ${error.message}`);
  return sendMessage(chatId, `✅ Deactivated \`${tid}\`.`, { parse_mode: "Markdown" });
}

// /stats [@handle]
async function cmdStats(chatId: number, arg: string) {
  const handle = arg.replace(/^@/, "").trim().toLowerCase();

  // Latest snapshot per account handle.
  const { data: snaps } = await db()
    .from(TABLES.accountSnapshots)
    .select("account_handle, followers, total_views, reel_count, snapshot_at")
    .order("snapshot_at", { ascending: false })
    .limit(5000);
  const latest: Record<string, any> = {};
  for (const s of snaps || []) {
    const h = (s as any).account_handle;
    if (h && !latest[h]) latest[h] = s;
  }

  // reels posted today (ET) per account
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const { data: posts } = await db()
    .from("va_posts")
    .select("account_handle, post_type, posted_at, logged_at")
    .eq("post_type", "reel")
    .order("logged_at", { ascending: false })
    .limit(1000);
  const reelsToday: Record<string, number> = {};
  for (const p of posts || []) {
    const t = (p as any).posted_at || (p as any).logged_at;
    if (!t) continue;
    const etDay = new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (etDay === today) reelsToday[(p as any).account_handle] = (reelsToday[(p as any).account_handle] || 0) + 1;
  }

  if (handle) {
    const s = latest[handle];
    const { data: acct } = await db().from(TABLES.ourAccounts).select("handle, active").ilike("handle", handle).limit(1);
    if (!s && !acct?.length) {
      await sendMessage(chatId, `No stats found for @${handle}. Is it one of your accounts?`);
      return;
    }
    const active = acct?.[0]?.active !== false;
    const lines = [
      `📊 *@${handle}* ${active ? "🟢 active" : "⏸ paused"}`,
      `👥 Followers: *${fmtNum(s?.followers || 0)}*`,
      `👁 Total views: *${fmtNum(s?.total_views || 0)}*`,
      `🎬 Reels: *${s?.reel_count || 0}* total · *${reelsToday[handle] || 0}* today`,
    ];
    await sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
    return;
  }

  // All our accounts
  const { data: accts } = await db().from(TABLES.ourAccounts).select("handle, active").order("handle");
  const accounts = (accts || []).filter((a: any) => a.handle);
  if (!accounts.length) {
    await sendMessage(chatId, "No accounts found in your `our_accounts` table.", { parse_mode: "Markdown" });
    return;
  }

  let totalFollowers = 0;
  let totalViews = 0;
  let totalReelsToday = 0;
  const lines: string[] = ["📊 *Your Accounts*", ""];
  for (const a of accounts) {
    const h = a.handle;
    const s = latest[h] || {};
    const rt = reelsToday[h] || 0;
    totalFollowers += Number(s.followers || 0);
    totalViews += Number(s.total_views || 0);
    totalReelsToday += rt;
    const status = a.active !== false ? "🟢" : "⏸";
    lines.push(`${status} *@${h}* — ${fmtNum(s.followers || 0)} followers · ${fmtNum(s.total_views || 0)} views · ${rt} today`);
  }
  lines.push("");
  lines.push(`*Totals:* ${fmtNum(totalFollowers)} followers · ${fmtNum(totalViews)} views · ${totalReelsToday} reels today`);
  await sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

// /niche — data-driven recommendation
async function cmdNiche(chatId: number) {
  const res = await fetch(`${appBaseUrl()}/api/inspiration-library/trending`, { headers: internalHeaders() });
  const t = await res.json();
  const opportunities = t.opportunities || [];
  const rising = t.rising_niches || [];
  const under = t.underperforming_niches || [];

  const lines: string[] = ["🎯 *NICHE RECOMMENDATIONS*", ""];

  lines.push("📈 *TOP OPPORTUNITIES* (high score, low competition):");
  if (opportunities.length) {
    opportunities.slice(0, 5).forEach((n: any, i: number) => {
      lines.push(`${i + 1}. *${n.name}* — score ${n.avg_score}, ${n.count} reels, ${n.viral_rate}% viral`);
    });
  } else {
    lines.push("_Not enough data yet._");
  }
  lines.push("");

  lines.push("🔥 *RISING NICHES* (by avg views):");
  rising.slice(0, 5).forEach((n: any, i: number) => {
    lines.push(`${i + 1}. *${n.name}* — ${fmtNum(n.avg_views)} avg views, ${n.count} reels, ${n.viral_count} viral`);
  });
  lines.push("");

  if (under.length) {
    lines.push("⚠️ *UNDERPERFORMING* (consider reducing):");
    under.slice(0, 5).forEach((n: any, i: number) => {
      lines.push(`${i + 1}. *${n.name}* — score ${n.avg_score}`);
    });
    lines.push("");
  }

  const top = opportunities[0] || rising[0];
  if (top) {
    lines.push(`💡 *SUGGESTION:* Focus on *${top.name}* — high engagement but few reels in the library. Scrape more accounts in this niche.`);
  }

  await sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// Shared: render a list of reels as photos with captions.
async function sendReels(chatId: number, reels: any[], emptyMsg: string) {
  if (!reels.length) {
    await sendMessage(chatId, emptyMsg);
    return;
  }
  for (const r of reels.slice(0, 5)) {
    const caption =
      `🎬 @${r.author_handle || "?"}\n` +
      `👁 ${fmtNum(r.views)} views · 🔥 viral score ${r.viral_score != null ? Math.round(Number(r.viral_score)) : "—"}\n` +
      `📂 ${r.niche || "untagged"}${r.sub_category ? " / " + r.sub_category : ""}\n` +
      `${r.reel_url || ""}`;
    if (r.thumbnail_url) {
      const resp = await sendPhoto(chatId, r.thumbnail_url, caption);
      if (!resp?.ok) await sendMessage(chatId, caption, { disable_web_page_preview: false });
    } else {
      await sendMessage(chatId, caption, { disable_web_page_preview: false });
    }
  }
}

// /trending
async function cmdTrending(chatId: number) {
  const res = await fetch(`${appBaseUrl()}/api/inspiration-library/trending`, { headers: internalHeaders() });
  const t = await res.json();
  await sendMessage(chatId, "🔥 *Top viral reels right now:*", { parse_mode: "Markdown" });
  await sendReels(chatId, t.viral_reels || [], "No trending reels found.");
}

// /viral
async function cmdViral(chatId: number) {
  const res = await fetch(`${appBaseUrl()}/api/inspiration-library/trending`, { headers: internalHeaders() });
  const t = await res.json();
  await sendMessage(chatId, "⚡ *Fresh viral (last 24h):*", { parse_mode: "Markdown" });
  await sendReels(chatId, t.fresh_viral || [], "No fresh viral reels in the last 24h.");
}

// /library
async function cmdLibrary(chatId: number) {
  const res = await fetch(`${appBaseUrl()}/api/inspiration-library/tag`, { headers: internalHeaders() });
  const s = await res.json();

  // tray breakdown
  const gres = await fetch(`${appBaseUrl()}/api/inspiration-library`, { headers: internalHeaders() });
  const g = await gres.json();
  const trayLines = (g.trays || [])
    .map((t: any) => `  • ${t.name}: ${t.stats?.total || 0} (${t.stats?.viral || 0} viral)`)
    .join("\n");

  const nicheLines = (s.niche_stats || [])
    .slice(0, 5)
    .map((n: any, i: number) => `  ${i + 1}. ${n.name}: ${n.count} (${fmtNum(n.views)} views)`)
    .join("\n");

  const uncategorized = (s.sub_category_stats || []).find((c: any) => c.name === "uncategorized")?.count || 0;

  const lines = [
    "📚 *Inspiration Library*",
    "",
    `Total reels: *${s.total || 0}*`,
    `Viral: *${s.viral || 0}*`,
    `Total views: *${fmtNum(s.total_views || 0)}*`,
    `Avg score: *${s.avg_score || 0}*`,
    `Uncategorized: *${uncategorized}*`,
    "",
    "*By tray:*",
    trayLines || "  _none_",
    "",
    "*Top niches:*",
    nicheLines || "  _none_",
  ];
  await sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// ─────────────────────────────────────────────────────────────
//  Reel performance commands (Task 5c)
// ─────────────────────────────────────────────────────────────

// /perf [@handle] — recent reel performance.
async function cmdPerf(chatId: number, arg: string) {
  const handle = arg.replace(/^@/, "").trim().toLowerCase();
  let q = db()
    .from("reel_performance")
    .select("account_handle, views_24h, avg_retention, skip_rate, ai_score, ai_strengths, ai_weaknesses, posted_at, status")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (handle) q = q.ilike("account_handle", handle);
  const { data, error } = await q;
  if (error) return sendMessage(chatId, `❌ ${error.message}`);
  const rows = (data || []).slice(0, 5);
  if (!rows.length) {
    return sendMessage(chatId, handle ? `No reel performance found for @${handle}.` : "No reel performance tracked yet.");
  }

  const lines = [`📊 *RECENT PERFORMANCE*${handle ? ` — @${handle}` : ""}`, ""];
  rows.forEach((r: any, i: number) => {
    const parts = [`*${i + 1}.* ${fmtNum(r.views_24h)} views`];
    if (r.avg_retention != null) parts.push(`${Math.round(Number(r.avg_retention))}% retention`);
    if (r.skip_rate != null) parts.push(`${Math.round(Number(r.skip_rate))}% skip`);
    if (r.ai_score != null) parts.push(`score ${Number(r.ai_score).toFixed(1)}/10`);
    lines.push(parts.join(", "));
    (r.ai_strengths || []).slice(0, 1).forEach((s: string) => lines.push(`   ✅ ${s}`));
    (r.ai_weaknesses || []).slice(0, 2).forEach((w: string) => lines.push(`   ⚠️ ${w}`));
    if (r.ai_score == null) lines.push(`   _not analyzed yet_`);
    lines.push("");
  });
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /winners — current winner templates.
async function cmdWinners(chatId: number) {
  const { data, error } = await db()
    .from("winner_templates")
    .select("name, avg_retention, avg_views, instance_count, sub_category, content_type, retention_curve")
    .order("avg_retention", { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) return sendMessage(chatId, `❌ ${error.message}`);
  const rows = data || [];
  if (!rows.length) return sendMessage(chatId, "No winner templates yet — they emerge once enough analyzed reels share a winning pattern.");

  const lines = ["🏆 *WINNER TEMPLATES*", ""];
  rows.forEach((t: any, i: number) => {
    lines.push(`*${i + 1}.* "${t.name}"`);
    lines.push(`   ${Math.round(Number(t.avg_retention || 0))}% retention, ${fmtNum(t.avg_views)} avg views, ${t.instance_count || 0} instances`);
    const pat = [t.content_type, t.sub_category].filter(Boolean).join("/");
    lines.push(`   Pattern: ${pat || "—"}${t.retention_curve ? `, ${t.retention_curve} curve` : ""}`);
    lines.push("");
  });
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /feedback <reel_url> — AI feedback for one reel (analyzes on demand).
async function cmdFeedback(chatId: number, arg: string) {
  const url = arg.trim();
  if (!url || !/instagram\.com/i.test(url)) {
    return sendMessage(chatId, "Usage: `/feedback <reel_url>`", { parse_mode: "Markdown" });
  }
  const { data } = await db().from("reel_performance").select("*").eq("reel_url", url).limit(1);
  let row = (data || [])[0];

  if (!row) {
    return sendMessage(chatId, "That reel isn't tracked yet. Send its analytics screenshots to me, or log it as a post first.");
  }

  if (!row.ai_analyzed_at) {
    await sendMessage(chatId, "⏳ Analyzing this reel…");
    try {
      const res = await fetch(`${appBaseUrl()}/api/reel-performance/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders() },
        body: JSON.stringify({ reel_url: url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return sendMessage(chatId, `❌ Analysis failed: ${j.error || res.status}`);
      }
      const { data: fresh } = await db().from("reel_performance").select("*").eq("reel_url", url).limit(1);
      row = (fresh || [])[0] || row;
    } catch (e: any) {
      return sendMessage(chatId, `❌ Analysis error: ${e?.message || String(e)}`);
    }
  }

  return sendMessage(chatId, formatFeedback(row), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// Render one reel_performance row as a feedback message.
function formatFeedback(row: any): string {
  const lines = [`🎯 *FEEDBACK* — @${row.account_handle}`, ""];
  const stat = [];
  if (row.views_24h != null) stat.push(`${fmtNum(row.views_24h)} views`);
  if (row.avg_retention != null) stat.push(`${Math.round(Number(row.avg_retention))}% retention`);
  if (row.skip_rate != null) stat.push(`${Math.round(Number(row.skip_rate))}% skip`);
  if (row.ai_score != null) stat.push(`score ${Number(row.ai_score).toFixed(1)}/10`);
  if (stat.length) lines.push(stat.join(" · "), "");
  if (row.ai_feedback) lines.push(row.ai_feedback, "");
  (row.ai_strengths || []).forEach((s: string) => lines.push(`✅ ${s}`));
  (row.ai_weaknesses || []).forEach((w: string) => lines.push(`⚠️ ${w}`));
  if (row.is_winner) lines.push("", "🏆 *Winner!*");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
//  VA / account-health commands
// ─────────────────────────────────────────────────────────────

// Total daily checklist items — mirrors the VA page SCHEDULE
// (app/va/page.tsx: 3 + 5 + 3 + 4 tasks).
const TOTAL_VA_TASKS = 15;

// Today's date in ET (YYYY-MM-DD) — the same "today" the VA page uses.
function etTodayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ET calendar day for an ISO timestamp, or "" if missing.
function etDayOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Our accounts, with active flag, ordered by handle.
async function ourAccountHandles(): Promise<{ handle: string; active: boolean }[]> {
  const { data } = await db().from(TABLES.ourAccounts).select("handle, active").order("handle");
  return (data || [])
    .filter((a: any) => a.handle)
    .map((a: any) => ({ handle: a.handle as string, active: a.active !== false }));
}

// /posted [@handle] — who posted a reel today (or one account's 7-day history).
async function cmdPosted(chatId: number, arg: string) {
  const handle = arg.replace(/^@/, "").trim().toLowerCase();
  const today = etTodayStr();

  if (handle) {
    const { data: posts } = await db()
      .from("va_posts")
      .select("posted_at, logged_at")
      .eq("post_type", "reel")
      .ilike("account_handle", handle)
      .order("logged_at", { ascending: false })
      .limit(300);
    const byDay: Record<string, number> = {};
    for (const p of posts || []) {
      const d = etDayOf((p as any).posted_at || (p as any).logged_at);
      if (d) byDay[d] = (byDay[d] || 0) + 1;
    }
    // Last 7 ET calendar days, newest first.
    const now = Date.now();
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(now - i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
    }
    const lines = [`📋 *@${handle} — last 7 days*`, ""];
    let total = 0;
    for (const d of days) {
      const c = byDay[d] || 0;
      total += c;
      lines.push(`${c > 0 ? "✅" : "❌"} ${d} — ${c} reel${c === 1 ? "" : "s"}`);
    }
    lines.push("", `Total: ${total} reels in 7 days`);
    return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
  }

  const accounts = await ourAccountHandles();
  const { data: posts } = await db()
    .from("va_posts")
    .select("account_handle, posted_at, logged_at")
    .eq("post_type", "reel")
    .order("logged_at", { ascending: false })
    .limit(1000);
  const countByAcct: Record<string, number> = {};
  for (const p of posts || []) {
    if (etDayOf((p as any).posted_at || (p as any).logged_at) !== today) continue;
    const h = (p as any).account_handle;
    if (h) countByAcct[h] = (countByAcct[h] || 0) + 1;
  }

  const lines = [`📋 *POSTING STATUS — ${today} (ET)*`, ""];
  let postedCount = 0;
  for (const a of accounts) {
    const c = countByAcct[a.handle] || 0;
    if (c > 0) {
      postedCount++;
      lines.push(`✅ @${a.handle} — ${c} reel${c === 1 ? "" : "s"} posted`);
    } else {
      lines.push(`❌ @${a.handle} — NO REELS POSTED TODAY`);
    }
  }
  lines.push("", `Posted: ${postedCount}/${accounts.length} accounts today`);
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /viralaccounts — which of our accounts have viral content right now.
// reel_performance has no is_viral flag, so treat a reel as viral when it's a
// winner, scored ≥7, or crossed 20K views in its first 24h.
async function cmdViralAccounts(chatId: number) {
  const accounts = await ourAccountHandles();
  const canon: Record<string, string> = {};
  for (const a of accounts) canon[a.handle.toLowerCase()] = a.handle;

  const { data } = await db()
    .from("reel_performance")
    .select("account_handle, views_24h, ai_score, is_winner")
    .order("views_24h", { ascending: false, nullsFirst: false })
    .limit(2000);

  const isViral = (r: any) =>
    r.is_winner === true || Number(r.ai_score || 0) >= 7 || Number(r.views_24h || 0) >= 20000;

  const byAcct: Record<string, { count: number; topViews: number; topScore: number }> = {};
  for (const r of data || []) {
    const h = canon[String((r as any).account_handle || "").toLowerCase()];
    if (!h || !isViral(r)) continue;
    const cur = byAcct[h] || { count: 0, topViews: 0, topScore: 0 };
    cur.count++;
    const v = Number((r as any).views_24h || 0);
    if (v >= cur.topViews) {
      cur.topViews = v;
      cur.topScore = Number((r as any).ai_score || 0);
    }
    byAcct[h] = cur;
  }

  const ranked = Object.entries(byAcct).sort((a, b) => b[1].count - a[1].count);
  const lines = ["🔥 *VIRAL ACCOUNTS*", ""];
  if (ranked.length) {
    ranked.forEach(([h, v], i) => {
      const score = v.topScore ? `, score ${v.topScore.toFixed(1)}` : "";
      lines.push(`${i + 1}. @${h} — ${v.count} viral reel${v.count === 1 ? "" : "s"} (top: ${fmtNum(v.topViews)} views${score})`);
    });
  } else {
    lines.push("_No viral content from any account right now._");
  }
  const noViral = accounts.filter((a) => !byAcct[a.handle]).map((a) => "@" + a.handle);
  if (noViral.length && ranked.length) {
    lines.push("", `No viral content from: ${noViral.join(", ")}`);
  }
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /niches — top viral niches in the inspiration library right now.
async function cmdNiches(chatId: number) {
  const { data } = await db()
    .from("inspiration_reels")
    .select("niche, views, first_seen_at")
    .eq("is_viral", true)
    .limit(5000);

  const now = Date.now();
  const byNiche: Record<string, { count: number; views: number; fresh: number }> = {};
  for (const r of data || []) {
    const niche = (String((r as any).niche || "").trim()) || "untagged";
    const cur = byNiche[niche] || { count: 0, views: 0, fresh: 0 };
    cur.count++;
    cur.views += Number((r as any).views || 0);
    const fs = (r as any).first_seen_at;
    if (fs && now - new Date(fs).getTime() <= 24 * 3600 * 1000) cur.fresh++;
    byNiche[niche] = cur;
  }

  const ranked = Object.entries(byNiche).sort((a, b) => b[1].count - a[1].count);
  if (!ranked.length) {
    return sendMessage(chatId, "No viral niches yet — not enough viral reels in the library.");
  }
  const lines = ["🎯 *TOP VIRAL NICHES*", ""];
  ranked.slice(0, 8).forEach(([niche, v], i) => {
    const avg = v.count ? Math.round(v.views / v.count) : 0;
    lines.push(`${i + 1}. *${niche}* — ${v.count} viral reel${v.count === 1 ? "" : "s"}, avg ${fmtNum(avg)} views`);
  });
  const hottest = [...ranked].sort((a, b) => b[1].fresh - a[1].fresh)[0];
  if (hottest && hottest[1].fresh > 0) {
    lines.push("", `🔥 Hottest: *${hottest[0]}* (${hottest[1].fresh} new viral in last 24h)`);
  }
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /vacheck — did the VAs do their job today? (checklist + posts per account)
async function cmdVaCheck(chatId: number) {
  const today = etTodayStr();
  const accounts = await ourAccountHandles();

  const { data: cl } = await db()
    .from("va_checklist")
    .select("account_handle, done_by")
    .eq("day", today)
    .limit(5000);
  const doneByAcct: Record<string, number> = {};
  const vaByAcct: Record<string, string> = {};
  for (const r of cl || []) {
    const h = (r as any).account_handle;
    if (!h) continue;
    doneByAcct[h] = (doneByAcct[h] || 0) + 1;
    if (!vaByAcct[h] && (r as any).done_by) vaByAcct[h] = (r as any).done_by;
  }

  const { data: posts } = await db()
    .from("va_posts")
    .select("account_handle, posted_at, logged_at, va_name")
    .eq("post_type", "reel")
    .order("logged_at", { ascending: false })
    .limit(1000);
  const reelsByAcct: Record<string, number> = {};
  for (const p of posts || []) {
    if (etDayOf((p as any).posted_at || (p as any).logged_at) !== today) continue;
    const h = (p as any).account_handle;
    if (!h) continue;
    reelsByAcct[h] = (reelsByAcct[h] || 0) + 1;
    if (!vaByAcct[h] && (p as any).va_name) vaByAcct[h] = (p as any).va_name;
  }

  const lines = [`✅ *VA DAILY CHECK — ${today}*`, ""];
  let postedAccts = 0;
  let needsAttention = 0;
  for (const a of accounts) {
    const h = a.handle;
    const done = doneByAcct[h] || 0;
    const reels = reelsByAcct[h] || 0;
    const va = vaByAcct[h] ? ` (VA: ${vaByAcct[h]})` : "";
    if (reels > 0) postedAccts++;
    if (reels === 0 || done === 0) needsAttention++;
    const remaining = Math.max(0, TOTAL_VA_TASKS - done);
    lines.push(`*@${h}*${va}:`);
    lines.push(`  ${done > 0 ? "✅" : "❌"} ${done}/${TOTAL_VA_TASKS} tasks done`);
    lines.push(`  ${reels > 0 ? "✅" : "❌"} ${reels} reel${reels === 1 ? "" : "s"} posted`);
    if (done > 0 && remaining > 0) lines.push(`  ⚠️ ${remaining} task${remaining === 1 ? "" : "s"} remaining`);
    lines.push("");
  }
  lines.push(`Summary: ${postedAccts}/${accounts.length} accounts posted, ${needsAttention} need${needsAttention === 1 ? "s" : ""} attention`);
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /banned — probe each account's profile; flag any that won't load.
async function cmdBanned(chatId: number) {
  const accounts = await ourAccountHandles();
  if (!accounts.length) {
    return sendMessage(chatId, "No accounts found in your `our_accounts` table.", { parse_mode: "Markdown" });
  }
  await sendMessage(chatId, `🚨 *ACCOUNT HEALTH CHECK*\n\n⏳ Checking ${accounts.length} accounts — this takes a few seconds…`, { parse_mode: "Markdown" });

  const results: { handle: string; ok: boolean; followers: number }[] = [];
  for (const a of accounts) {
    try {
      const p = await scrapeProfile(a.handle);
      results.push({ handle: a.handle, ok: Boolean(p && p.username), followers: p?.followers || 0 });
    } catch {
      results.push({ handle: a.handle, ok: false, followers: 0 });
    }
  }

  const lines = ["🚨 *ACCOUNT HEALTH CHECK*", ""];
  let issues = 0;
  for (const r of results) {
    if (r.ok) {
      lines.push(`✅ @${r.handle} — ${fmtNum(r.followers)} followers, active`);
    } else {
      issues++;
      lines.push(`❌ @${r.handle} — PROFILE NOT ACCESSIBLE (may be banned/restricted)`);
    }
  }
  lines.push("", issues ? `Issues: ${issues} account${issues === 1 ? "" : "s"} need${issues === 1 ? "s" : ""} attention` : "All accounts healthy ✅");
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /notifybans [on|off] — toggle automatic ban-detection notifications.
// Stored in app_settings; the worker will honor it on each cycle (added later).
async function cmdNotifyBans(chatId: number, arg: string) {
  const a = arg.trim().toLowerCase();
  const { data } = await db().from("app_settings").select("value").eq("key", "notify_bans").limit(1);
  const current = Boolean((data?.[0]?.value as any)?.enabled);
  let next: boolean;
  if (["on", "enable", "true", "1"].includes(a)) next = true;
  else if (["off", "disable", "false", "0"].includes(a)) next = false;
  else next = !current; // no/unknown arg → toggle

  const { error } = await db().from("app_settings").upsert(
    { key: "notify_bans", value: { enabled: next }, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) return sendMessage(chatId, `❌ ${error.message}`);
  return sendMessage(
    chatId,
    `${next ? "🔔" : "🔕"} Auto ban notifications are now *${next ? "ON" : "OFF"}*.\n` +
      `_The worker will ${next ? "check account accessibility each cycle and alert here if any go down" : "no longer send ban alerts"}._`,
    { parse_mode: "Markdown" }
  );
}

// ─────────────────────────────────────────────────────────────
//  VA management commands (assign / unassign / vas / schedule)
// ─────────────────────────────────────────────────────────────

// /assign <account_handle> <va_name> — assign an account to a VA.
async function cmdAssign(chatId: number, arg: string) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const handle = (parts[0] || "").replace(/^@/, "").trim().toLowerCase();
  const vaName = parts.slice(1).join(" ").trim();
  if (!handle || !vaName) {
    return sendMessage(chatId, "Usage: `/assign <account_handle> <va_name>`", { parse_mode: "Markdown" });
  }
  try {
    // Retire any existing active assignment for this account, then insert.
    await db()
      .from("account_assignments")
      .update({ is_active: false, unassigned_at: new Date().toISOString() })
      .eq("account_handle", handle)
      .eq("is_active", true);
    const { error } = await db()
      .from("account_assignments")
      .insert({ account_handle: handle, va_name: vaName, is_active: true });
    if (error) return sendMessage(chatId, `❌ ${error.message}`);
    return sendMessage(chatId, `✅ Assigned @${handle} → *${vaName}*.`, { parse_mode: "Markdown" });
  } catch (e: any) {
    return sendMessage(chatId, `❌ ${e?.message || String(e)}`);
  }
}

// /unassign <account_handle> — deactivate the account's active assignment.
async function cmdUnassign(chatId: number, arg: string) {
  const handle = (arg.split(/\s+/)[0] || "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return sendMessage(chatId, "Usage: `/unassign <account_handle>`", { parse_mode: "Markdown" });
  try {
    const { data } = await db()
      .from("account_assignments")
      .select("id, va_name")
      .eq("account_handle", handle)
      .eq("is_active", true)
      .limit(1);
    if (!data?.length) return sendMessage(chatId, `@${handle} isn't assigned to anyone.`);
    await db()
      .from("account_assignments")
      .update({ is_active: false, unassigned_at: new Date().toISOString() })
      .eq("account_handle", handle)
      .eq("is_active", true);
    return sendMessage(chatId, `✅ Unassigned @${handle} (was ${(data[0] as any).va_name}).`);
  } catch (e: any) {
    return sendMessage(chatId, `❌ ${e?.message || String(e)}`);
  }
}

// /vas — list all VAs and their assigned accounts.
async function cmdVas(chatId: number) {
  const { data: vas } = await db()
    .from("va_profiles")
    .select("name, role, max_accounts, is_active")
    .eq("is_active", true)
    .order("name");
  const { data: assigns } = await db()
    .from("account_assignments")
    .select("account_handle, va_name")
    .eq("is_active", true);

  const byVa: Record<string, string[]> = {};
  for (const a of assigns || []) {
    const v = (a as any).va_name;
    if (!v) continue;
    (byVa[v] = byVa[v] || []).push((a as any).account_handle);
  }

  if (!vas?.length) return sendMessage(chatId, "No VAs yet. Add them in the VA Management page.");

  const lines = ["👥 *VAs & ACCOUNTS*", ""];
  for (const v of vas as any[]) {
    const accts = byVa[v.name] || [];
    lines.push(`*${v.name}* (${v.role}) — ${accts.length}/${v.max_accounts} accounts`);
    lines.push(accts.length ? "  " + accts.map((h) => "@" + h).join(", ") : "  _none assigned_");
    lines.push("");
  }
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// /syncmembers — pull TeamFlow members (tf_members, same shared Supabase) into
// va_profiles + telegram_users. Members without a telegram_id are skipped.
async function cmdSyncMembers(chatId: number) {
  try {
    const [{ data: members }, { data: memberTeams }, { data: teams }] = await Promise.all([
      db().from("tf_members").select("*").eq("status", "active"),
      db().from("tf_member_teams").select("member_id, team_id"),
      db().from("tf_teams").select("id, name"),
    ]);

    const teamNamesFor = (memberId: string): string[] => {
      const ids = (memberTeams || []).filter((r: any) => r.member_id === memberId).map((r: any) => r.team_id);
      return (teams || []).filter((t: any) => ids.includes(t.id)).map((t: any) => String(t.name));
    };

    const synced: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const m of (members || []) as any[]) {
      if (!m.telegram_id) {
        skipped.push(m.name);
        continue;
      }
      const isManager = teamNamesFor(m.id).some((t) => t.toLowerCase().includes("manager"));
      const profileRole = isManager ? "manager" : "va";
      const userRole = isManager ? "content" : "va";

      try {
        // Manual upsert into va_profiles — match by telegram_id, then name.
        const { data: byTid } = await db().from("va_profiles").select("id").eq("telegram_id", m.telegram_id).limit(1);
        let profileId = byTid?.[0]?.id as string | undefined;
        if (!profileId) {
          const { data: byName } = await db().from("va_profiles").select("id").ilike("name", m.name).limit(1);
          profileId = byName?.[0]?.id;
        }
        if (profileId) {
          const { error } = await db()
            .from("va_profiles")
            .update({ name: m.name, telegram_id: m.telegram_id, role: profileRole, is_active: true, updated_at: new Date().toISOString() })
            .eq("id", profileId);
          if (error) throw error;
        } else {
          const { error } = await db()
            .from("va_profiles")
            .insert({ name: m.name, telegram_id: m.telegram_id, role: profileRole, max_accounts: 15, is_active: true });
          if (error) throw error;
        }

        // telegram_users — keyed by telegram_id; never downgrade an existing admin.
        const { data: existing } = await db().from("telegram_users").select("role").eq("telegram_id", m.telegram_id).limit(1);
        const finalRole = existing?.[0]?.role === "admin" ? "admin" : userRole;
        const { error: userErr } = await db().from("telegram_users").upsert(
          {
            telegram_id: m.telegram_id,
            username: m.telegram_username || null,
            first_name: m.name,
            role: finalRole,
            is_active: true,
            added_by: "teamflow-sync",
          },
          { onConflict: "telegram_id" }
        );
        if (userErr) throw userErr;
        synced.push(m.name);
      } catch (e: any) {
        errors.push(`${m.name}: ${e?.message || String(e)}`);
      }
    }

    const lines = ["🔄 *TeamFlow → Reel Lab sync*", ""];
    lines.push(`✅ Synced: ${synced.length}${synced.length ? ` (${synced.join(", ")})` : ""}`);
    if (skipped.length) lines.push(`⚠️ Skipped (no Telegram ID): ${skipped.join(", ")}`);
    if (errors.length) lines.push(`❌ Errors:`, ...errors.map((e) => `  • ${e}`));
    return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  } catch (e: any) {
    return sendMessage(chatId, `❌ Sync failed: ${e?.message || String(e)}`);
  }
}

// /schedule <account_handle> — show an account's posting schedule.
async function cmdSchedule(chatId: number, arg: string) {
  const handle = (arg.split(/\s+/)[0] || "").replace(/^@/, "").trim().toLowerCase();
  if (!handle) return sendMessage(chatId, "Usage: `/schedule <account_handle>`", { parse_mode: "Markdown" });
  const { data } = await db()
    .from("posting_schedule")
    .select("slot_name, post_time, post_type")
    .eq("account_handle", handle)
    .eq("is_active", true)
    .order("post_time");
  if (!data?.length) return sendMessage(chatId, `No posting schedule set for @${handle}.`);
  const lines = [`🗓 *@${handle} — posting schedule*`, ""];
  for (const s of data as any[]) {
    lines.push(`• *${s.post_time}* ${s.slot_name ? `(${s.slot_name}) ` : ""}— ${s.post_type}`);
  }
  return sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown", disable_web_page_preview: true });
}

// ─────────────────────────────────────────────────────────────
//  Photo flow — VA sends an analytics screenshot
// ─────────────────────────────────────────────────────────────

// The 5 most recent reels this team posted (for the "which reel?" keyboard).
async function recentPostedReels(): Promise<{ reel_url: string; account_handle: string }[]> {
  const { data } = await db()
    .from("va_posts")
    .select("link, account_handle, posted_at, logged_at")
    .eq("post_type", "reel")
    .order("logged_at", { ascending: false })
    .limit(30);
  const seen = new Set<string>();
  const out: { reel_url: string; account_handle: string }[] = [];
  for (const p of (data || []) as any[]) {
    const url = (p.link || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ reel_url: url, account_handle: p.account_handle || "" });
    if (out.length >= 5) break;
  }
  return out;
}

async function handlePhoto(chatId: number, msg: any) {
  // Largest available size is the last element of the photo array.
  const photos: any[] = Array.isArray(msg.photo) ? msg.photo : [];
  const best = photos[photos.length - 1];
  if (!best?.file_id) return sendMessage(chatId, "Couldn't read that photo — try sending it again.");

  await sendMessage(chatId, "⏳ Uploading screenshot…");

  // getFile → download from Telegram → store in Supabase.
  const gf = await getFile(best.file_id);
  const filePath = gf?.result?.file_path;
  if (!filePath) return sendMessage(chatId, "❌ Couldn't fetch the photo from Telegram.");
  const dl = await fetch(fileDownloadUrl(filePath));
  if (!dl.ok) return sendMessage(chatId, "❌ Couldn't download the photo.");
  const mime = dl.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buf = Buffer.from(await dl.arrayBuffer());
  const publicUrl = await storeScreenshot(buf, mime.startsWith("image/") ? mime : "image/jpeg");
  if (!publicUrl) return sendMessage(chatId, "❌ Couldn't store the screenshot. Is the `reel-screenshots` bucket set up?");

  const reels = await recentPostedReels();
  if (!reels.length) {
    photoPending.delete(chatId);
    return sendMessage(chatId, "✅ Got the screenshot, but I don't see any recently posted reels to attach it to. Log the reel with the VA tool first.");
  }

  photoPending.set(chatId, { screenshotUrl: publicUrl, reels });
  const buttons: InlineButton[] = reels.map((r, i) => ({
    text: `@${r.account_handle} — ${r.reel_url.replace(/^https?:\/\/(www\.)?instagram\.com\//, "").slice(0, 24)}`,
    callback_data: `perfreel:${i}`,
  }));
  buttons.push({ text: "✖ Cancel", callback_data: "perfcancel:1" });
  return sendMessage(chatId, "📸 Got the screenshot! Which reel is this for?", {
    reply_markup: inlineKeyboard(buttonGrid(buttons, 1)),
  });
}

// VA tapped a reel → attach the pending screenshot; auto-analyze at 2+.
async function attachScreenshot(chatId: number, messageId: number, idx: number) {
  const p = photoPending.get(chatId);
  if (!p) {
    return editMessageText(chatId, messageId, "⚠️ This screenshot expired. Send it again.");
  }
  const reel = p.reels[idx];
  if (!reel) return editMessageText(chatId, messageId, "⚠️ Couldn't match that reel. Send the screenshot again.");
  photoPending.delete(chatId);

  // Find or create the reel_performance row, then append the screenshot URL.
  const { data: existing } = await db()
    .from("reel_performance")
    .select("id, screenshot_urls")
    .eq("reel_url", reel.reel_url)
    .limit(1);
  let rowId = existing?.[0]?.id as string | undefined;
  const current: string[] = Array.isArray(existing?.[0]?.screenshot_urls) ? existing![0].screenshot_urls : [];
  const shots = Array.from(new Set([...current, p.screenshotUrl]));

  if (rowId) {
    await db().from("reel_performance").update({ screenshot_urls: shots, updated_at: new Date().toISOString() }).eq("id", rowId);
  } else {
    const { data: ins } = await db()
      .from("reel_performance")
      .insert({ reel_url: reel.reel_url, account_handle: reel.account_handle || "unknown", screenshot_urls: shots, status: "posted" })
      .select("id")
      .limit(1);
    rowId = ins?.[0]?.id;
  }

  await editMessageText(
    chatId,
    messageId,
    `✅ Saved screenshot for @${reel.account_handle} (${shots.length} total).`,
  );

  // 2+ screenshots → run the analysis automatically.
  if (shots.length >= 2 && rowId) {
    await sendMessage(chatId, "⏳ 2 screenshots collected — analyzing…");
    try {
      const res = await fetch(`${appBaseUrl()}/api/reel-performance/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders() },
        body: JSON.stringify({ id: rowId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return sendMessage(chatId, `❌ Analysis failed: ${j.error || res.status}`);
      }
      const { data: fresh } = await db().from("reel_performance").select("*").eq("id", rowId).limit(1);
      if (fresh?.[0]) return sendMessage(chatId, formatFeedback(fresh[0]), { parse_mode: "Markdown", disable_web_page_preview: true });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Analysis error: ${e?.message || String(e)}`);
    }
  } else {
    await sendMessage(chatId, "Send one more screenshot (retention + demographics) and I'll analyze it automatically.");
  }
}

// ─────────────────────────────────────────────────────────────
//  Import flow
// ─────────────────────────────────────────────────────────────

async function startImportFlow(chatId: number, text: string) {
  pending.set(chatId, { text });
  const buttons: InlineButton[] = TRAYS.map((t) => ({ text: t, callback_data: `tray:${t}` }));
  buttons.push({ text: "✖ Cancel", callback_data: "cancel:1" });
  await sendMessage(chatId, "📥 Which tray should these go into?", {
    reply_markup: inlineKeyboard(buttonGrid(buttons, 3)),
  });
}

// Run the bulk import (fire-and-forget from the webhook so Telegram
// doesn't time out and retry). Sends a result message when done.
async function runImport(chatId: number, p: Pending) {
  try {
    const res = await fetch(`${appBaseUrl()}/api/inspiration-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalHeaders() },
      body: JSON.stringify({
        text: p.text,
        tray: p.tray || "regular",
        niche: p.niche || "",
        sub_category: (p as any).sub_category || "",
        import_accounts: true,
        account_count: 25,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      await sendMessage(chatId, `❌ Import failed: ${j.error || res.status}`);
      return;
    }
    const parts = [
      `✅ Imported *${j.total_reels || 0}* reels into *${j.tray}* tray`,
      `  • ${j.reels_added || 0} from direct links`,
      `  • ${j.account_reels_added || 0} from ${j.accounts_processed || 0} accounts`,
    ];
    if (j.niche) parts.push(`  • niche: ${j.niche}`);
    if (j.sub_category) parts.push(`  • sub-category: ${j.sub_category}`);
    if (j.failed?.length) parts.push(`  ⚠️ ${j.failed.length} failed`);
    await sendMessage(chatId, parts.join("\n"), { parse_mode: "Markdown" });
  } catch (e: any) {
    await sendMessage(chatId, `❌ Import error: ${e?.message || String(e)}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  Conversational (natural-language) handler — ChatGPT-style.
//  Any message that isn't a command and isn't an import is routed
//  through Gemini, grounded with live data about the user's accounts.
// ─────────────────────────────────────────────────────────────

// Gather just-enough live context for whatever the user is asking about.
async function gatherContext(question: string): Promise<string> {
  const q = question.toLowerCase();
  const lines: string[] = [];

  // Always include an account summary (from the latest account snapshots).
  try {
    const { data: snaps } = await db()
      .from(TABLES.accountSnapshots)
      .select("account_handle, followers, total_views, snapshot_at")
      .order("snapshot_at", { ascending: false })
      .limit(2000);
    const latest: Record<string, any> = {};
    for (const s of snaps || []) {
      const h = (s as any).account_handle;
      if (h && !latest[h]) latest[h] = s;
    }
    const summary = Object.entries(latest)
      .slice(0, 25)
      .map(([h, s]) => `@${h} (${fmtNum((s as any).followers || 0)} followers, ${fmtNum((s as any).total_views || 0)} views)`)
      .join(", ");
    if (summary) lines.push("Accounts: " + summary);
  } catch { /* best effort */ }

  // Posting / VA activity.
  if (/(post|va|job|today|reel|upload)/.test(q)) {
    try {
      const today = etTodayStr();
      const { data: posts } = await db()
        .from("va_posts")
        .select("account_handle, post_type, posted_at, logged_at")
        .eq("post_type", "reel")
        .order("logged_at", { ascending: false })
        .limit(200);
      const todayByAcct: Record<string, number> = {};
      let recent = 0;
      for (const p of posts || []) {
        if (etDayOf((p as any).posted_at || (p as any).logged_at) === today) {
          todayByAcct[(p as any).account_handle] = (todayByAcct[(p as any).account_handle] || 0) + 1;
        }
        if (recent < 10) recent++;
      }
      const postedList = Object.entries(todayByAcct).map(([h, c]) => `@${h}: ${c}`).join(", ");
      lines.push(`\nReels posted today (${today} ET): ${postedList || "none yet"}`);
    } catch { /* best effort */ }
  }

  // Viral / trending inspiration.
  if (/(viral|trend|hot|working|blow)/.test(q)) {
    try {
      const { data: viral } = await db()
        .from(TABLES.inspirationReels)
        .select("author_handle, niche, views, viral_score")
        .eq("is_viral", true)
        .order("viral_score", { ascending: false, nullsFirst: false })
        .limit(10);
      const list = (viral || [])
        .map((r: any) => `@${r.author_handle} ${fmtNum(r.views)} views (${r.niche || "untagged"}, score ${r.viral_score != null ? Math.round(Number(r.viral_score)) : "—"})`)
        .join("\n");
      if (list) lines.push("\nTop viral reels:\n" + list);
    } catch { /* best effort */ }
  }

  // Niche performance.
  if (/(niche|focus|should|next|topic|category)/.test(q)) {
    try {
      const { data: rows } = await db()
        .from(TABLES.inspirationReels)
        .select("niche, views, is_viral")
        .limit(5000);
      const nicheMap: Record<string, { count: number; views: number; viral: number }> = {};
      for (const r of rows || []) {
        const n = (String((r as any).niche || "").trim()) || "untagged";
        if (!nicheMap[n]) nicheMap[n] = { count: 0, views: 0, viral: 0 };
        nicheMap[n].count++;
        nicheMap[n].views += Number((r as any).views || 0);
        if ((r as any).is_viral) nicheMap[n].viral++;
      }
      const top = Object.entries(nicheMap).sort((a, b) => b[1].views - a[1].views).slice(0, 10);
      const list = top.map(([n, s]) => `${n}: ${s.count} reels, ${fmtNum(s.views)} views, ${s.viral} viral`).join("\n");
      if (list) lines.push("\nNiche performance (by total views):\n" + list);
    } catch { /* best effort */ }
  }

  // Our reel performance.
  if (/(perform|best|worst|score|retention|winner)/.test(q)) {
    try {
      const { data: perf } = await db()
        .from("reel_performance")
        .select("account_handle, ai_score, views_24h, avg_retention, is_winner")
        .order("ai_score", { ascending: false, nullsFirst: false })
        .limit(10);
      const list = (perf || [])
        .map((p: any) => `@${p.account_handle} ${fmtNum(p.views_24h)} views, score ${p.ai_score != null ? Number(p.ai_score).toFixed(1) : "—"}${p.is_winner ? " 🏆" : ""}`)
        .join("\n");
      if (list) lines.push("\nTop performing reels:\n" + list);
    } catch { /* best effort */ }
  }

  return lines.join("\n");
}

async function handleNaturalLanguage(chatId: number, text: string) {
  // A typing hint so the user knows we're working (best-effort).
  await sendMessage(chatId, "💭 Thinking…").catch(() => {});

  const context = await gatherContext(text);
  const prompt = `You are a helpful Instagram growth assistant for a team that runs multiple Instagram accounts and studies viral reels.

The user asked: "${text}"

Here is current data about their accounts and library:
${context || "(no data available)"}

Answer in a clear, concise way. Use emojis. Keep it short (max 300 words). Base your answer on the data above; if the data doesn't answer the question, say so and suggest which command (e.g. /stats, /niche, /trending, /perf) might help.`;

  const response = await generateResponse(prompt, { temperature: 0.7, maxOutputTokens: 600 });
  await sendMessage(chatId, response, { disable_web_page_preview: true });
}

// ─────────────────────────────────────────────────────────────
//  Update dispatch
// ─────────────────────────────────────────────────────────────

async function handleMessage(msg: any) {
  const chatId = msg.chat?.id;
  const from: TgFrom = msg.from || {};
  const telegramId = Number(from.id);
  const text: string = (msg.text || "").trim();
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  if (!chatId || !telegramId || (!text && !hasPhoto)) return;

  // ── Authorization gate ──────────────────────────────────────
  const auth = await isAuthorized(telegramId, from);
  if (!auth.ok) {
    console.warn(`telegram unauthorized access attempt: id=${telegramId} username=@${from.username || "?"} text=${text.slice(0, 80)}`);
    return sendMessage(chatId, unauthorizedMessage(telegramId), { parse_mode: "Markdown" });
  }

  // ── Photo: a VA is uploading a reel-analytics screenshot ────
  if (hasPhoto) {
    return handlePhoto(chatId, msg);
  }

  if (text.startsWith("/")) {
    // strip bot mention (/stats@MyBot) and split off argument
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split("@")[0].toLowerCase();
    const arg = rest.join(" ").trim();

    // Role gate — commands not listed are open to all authorized users.
    const allowedRoles = COMMAND_ROLES[cmd];
    if (allowedRoles && !allowedRoles.includes(auth.role)) {
      return sendMessage(chatId, `🚫 The \`${cmd}\` command isn't available for your role (*${auth.role}*).`, { parse_mode: "Markdown" });
    }

    switch (cmd) {
      case "/start":
      case "/help":
        return cmdHelp(chatId, auth.role);
      case "/stats":
        return cmdStats(chatId, arg);
      case "/niche":
        return cmdNiche(chatId);
      case "/trending":
        return cmdTrending(chatId);
      case "/viral":
        return cmdViral(chatId);
      case "/library":
        return cmdLibrary(chatId);
      case "/perf":
        return cmdPerf(chatId, arg);
      case "/winners":
        return cmdWinners(chatId);
      case "/feedback":
        return cmdFeedback(chatId, arg);
      case "/posted":
        return cmdPosted(chatId, arg);
      case "/viralaccounts":
      case "/vaccounts":
        return cmdViralAccounts(chatId);
      case "/niches":
        return cmdNiches(chatId);
      case "/vacheck":
      case "/checkvas":
        return cmdVaCheck(chatId);
      case "/banned":
      case "/checkaccounts":
        return cmdBanned(chatId);
      case "/notifybans":
        return cmdNotifyBans(chatId, arg);
      case "/assign":
        return cmdAssign(chatId, arg);
      case "/unassign":
        return cmdUnassign(chatId, arg);
      case "/vas":
        return cmdVas(chatId);
      case "/schedule":
        return cmdSchedule(chatId, arg);
      case "/syncmembers":
        return cmdSyncMembers(chatId);
      case "/inspire":
        if (arg && looksLikeImport(arg)) return startImportFlow(chatId, arg);
        return sendMessage(chatId, "Send me Instagram reel links or @handles to import (you can include them after /inspire or in a separate message).");
      case "/adduser":
        return cmdAddUser(chatId, arg, from);
      case "/users":
        return cmdListUsers(chatId);
      case "/removeuser":
        return cmdRemoveUser(chatId, arg);
      default:
        return sendMessage(chatId, "Unknown command. Send /help for the list.");
    }
  }

  // Non-command message: treat as import if it contains links / handles.
  if (looksLikeImport(text)) {
    if (!IMPORT_ROLES.includes(auth.role)) {
      return sendMessage(chatId, `🚫 Importing inspiration isn't available for your role (*${auth.role}*).`, { parse_mode: "Markdown" });
    }
    return startImportFlow(chatId, text);
  }

  // Not a command, not an import → treat as a natural-language question.
  return handleNaturalLanguage(chatId, text);
}

async function handleCallback(cb: any) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data: string = cb.data || "";
  const telegramId = Number(cb.from?.id);

  // Any authorized user may run these; the import flow needs IMPORT_ROLES.
  const auth = telegramId ? await isAuthorized(telegramId, cb.from) : { ok: false, role: "" };
  if (!auth.ok) {
    return answerCallbackQuery(cb.id, "Not authorized");
  }

  const [action, ...valueParts] = data.split(":");
  const value = valueParts.join(":");

  // ── Screenshot → reel attachment flow (open to all authorized users) ──
  if (action === "perfcancel") {
    await answerCallbackQuery(cb.id);
    photoPending.delete(chatId);
    return editMessageText(chatId, messageId, "❌ Screenshot discarded.");
  }
  if (action === "perfreel") {
    await answerCallbackQuery(cb.id);
    if (!chatId) return;
    return attachScreenshot(chatId, messageId, Number(value));
  }

  // Remaining callbacks belong to the import flow — gate to IMPORT_ROLES.
  if (!IMPORT_ROLES.includes(auth.role)) {
    return answerCallbackQuery(cb.id, "Not authorized");
  }
  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  const p = pending.get(chatId);

  if (action === "cancel") {
    pending.delete(chatId);
    return editMessageText(chatId, messageId, "❌ Import cancelled.");
  }

  if (!p) {
    return editMessageText(chatId, messageId, "⚠️ This import expired. Send the links again to restart.");
  }

  if (action === "tray") {
    p.tray = value;
    const niches = await loadNiches();
    return editMessageText(chatId, messageId, `Tray: *${value}*\n\n🏷 Pick a niche:`, {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard(optionButtons("niche", niches)),
    });
  }

  if (action === "niche") {
    p.niche = value === SKIP ? "" : value;
    const subs = await loadSubCategories();
    return editMessageText(chatId, messageId, `Tray: *${p.tray}* · Niche: *${p.niche || "—"}*\n\n📁 Pick a sub-category:`, {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard(optionButtons("sub", subs)),
    });
  }

  if (action === "sub") {
    (p as any).sub_category = value === SKIP ? "" : value;
    pending.delete(chatId);
    await editMessageText(
      chatId,
      messageId,
      `⏳ Importing into *${p.tray}* tray${p.niche ? " · " + p.niche : ""}...\nThis can take a minute for accounts.`,
      { parse_mode: "Markdown" }
    );
    // Fire-and-forget so we return 200 to Telegram immediately.
    runImport(chatId, p);
    return;
  }
}

export async function POST(req: NextRequest, ctx: { params: { seg?: string[] } }) {
  if (!secretOk(req, ctx.params?.seg)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!telegramConfigured()) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" }, { status: 200 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (e: any) {
    // Never 500 back to Telegram (it would retry the update).
    console.error("telegram webhook error:", e?.message || e);
  }
  return NextResponse.json({ ok: true });
}

// A GET on the webhook path is handy for a quick liveness check.
export async function GET() {
  return NextResponse.json({ ok: true, configured: telegramConfigured() });
}
