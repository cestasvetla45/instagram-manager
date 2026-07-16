// Service worker: dedupes captured handles, batches them, ships to the app.
const FLUSH_MS = 20_000;
const MAX_BATCH = 200;

let buffer = new Map(); // handle → {source, pageHandle}
let flushTimer = null;

async function getSettings() {
  const d = await chrome.storage.sync.get({ appUrl: "", secret: "", enabled: true });
  return d;
}

async function bumpStats(patch) {
  const { stats } = await chrome.storage.local.get({ stats: { captured: 0, sent: 0, added: 0, lastError: "" } });
  for (const k of ["captured", "sent", "added"]) if (patch[k]) stats[k] += patch[k];
  if (patch.lastError !== undefined) stats.lastError = patch.lastError;
  stats.updatedAt = Date.now();
  await chrome.storage.local.set({ stats });
}

async function flush() {
  flushTimer = null;
  if (!buffer.size) return;
  const { appUrl, secret, enabled } = await getSettings();
  if (!enabled || !appUrl) return;

  const entries = [...buffer.entries()].slice(0, MAX_BATCH);
  for (const [h] of entries) buffer.delete(h);

  // Group by source so the queue records why each handle surfaced.
  const groups = {};
  for (const [handle, meta] of entries) {
    const key = `${meta.source}|${meta.pageHandle}`;
    (groups[key] = groups[key] || []).push(handle);
  }

  let sent = 0,
    added = 0,
    lastError = "";
  for (const key of Object.keys(groups)) {
    const [source, pageHandle] = key.split("|");
    try {
      const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/discovery/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ingest-secret": secret },
        body: JSON.stringify({ handles: groups[key], source, sourceHandle: pageHandle }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = j.error || `HTTP ${res.status}`;
        continue;
      }
      sent += groups[key].length;
      added += Number(j.added) || 0;
    } catch (e) {
      lastError = String((e && e.message) || e);
    }
  }
  await bumpStats({ sent, added, lastError });
  if (buffer.size) scheduleFlush();
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "RL_DISCOVERY_USERS") {
    const before = buffer.size;
    for (const u of msg.users || []) {
      if (!buffer.has(u)) buffer.set(u, { source: msg.source || "suggested", pageHandle: msg.pageHandle || "" });
    }
    const captured = buffer.size - before;
    if (captured) bumpStats({ captured });
    if (buffer.size >= MAX_BATCH) flush();
    else scheduleFlush();
  }
  if (msg && msg.type === "RL_TEST_CONNECTION") {
    (async () => {
      const { appUrl, secret } = await getSettings();
      try {
        const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/discovery/ingest`, {
          headers: { "x-ingest-secret": secret },
        });
        const j = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok && j.ok, error: j.error || (res.ok ? "" : `HTTP ${res.status}`) });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }
  if (msg && msg.type === "RL_FLUSH_NOW") {
    flush().then(() => sendResponse({ ok: true }));
    return true;
  }
});
