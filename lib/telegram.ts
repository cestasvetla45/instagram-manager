// ─────────────────────────────────────────────────────────────
//  Telegram Bot API client.
//  The bot runs as webhook routes inside this Next.js app.
// ─────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export function telegramConfigured(): boolean {
  return Boolean(BOT_TOKEN);
}

// The public base URL of this app (used to register the webhook and
// to self-call our own API routes from inside the webhook handler).
export function appBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "https://instagram-tool-production-e4f2.up.railway.app";
}

type SendOpts = {
  parse_mode?: string;
  reply_markup?: any;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
};

async function call(method: string, payload: any): Promise<any> {
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function sendMessage(chatId: string | number, text: string, opts?: SendOpts) {
  return call("sendMessage", { chat_id: chatId, text, ...opts });
}

export async function sendPhoto(chatId: string | number, photo: string, caption?: string, opts?: SendOpts) {
  return call("sendPhoto", { chat_id: chatId, photo, caption, ...opts });
}

// Edit an existing message's text (used after an inline-keyboard tap).
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  opts?: SendOpts
) {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...opts });
}

// Acknowledge a button press so Telegram stops the "loading" spinner.
export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// Register the webhook URL with Telegram.
export async function setWebhook(url: string, secretToken?: string) {
  const payload: any = { url, allowed_updates: ["message", "callback_query"] };
  if (secretToken) payload.secret_token = secretToken;
  return call("setWebhook", payload);
}

// Verify the webhook is set.
export async function getWebhookInfo() {
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`${API}/getWebhookInfo`);
  return res.json();
}

// Fetch the bot's own identity (used for the dashboard link).
export async function getMe() {
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`${API}/getMe`);
  return res.json();
}

// Resolve a file_id → its downloadable file_path on Telegram's servers.
export async function getFile(fileId: string): Promise<any> {
  return call("getFile", { file_id: fileId });
}

// Public URL to download a file returned by getFile().
export function fileDownloadUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
}

// Headers that let the webhook's server-to-server self-calls bypass the
// auth middleware (which otherwise 401s cookie-less requests). Matched
// against TELEGRAM_WEBHOOK_SECRET in middleware.ts.
export function internalHeaders(): Record<string, string> {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  return s ? { "x-internal-secret": s } : {};
}

// ---------- inline keyboard helpers ----------
export type InlineButton = { text: string; callback_data: string };

export function inlineKeyboard(rows: InlineButton[][]) {
  return { inline_keyboard: rows };
}

// Chunk a flat list of buttons into rows of `perRow`.
export function buttonGrid(buttons: InlineButton[], perRow = 3): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}
