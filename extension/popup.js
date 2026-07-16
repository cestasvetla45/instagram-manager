const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.sync.get({ appUrl: "", secret: "", enabled: true });
  $("appUrl").value = s.appUrl;
  $("secret").value = s.secret;
  $("enabled").checked = s.enabled;
  renderStats();
}

async function renderStats() {
  const { stats } = await chrome.storage.local.get({ stats: null });
  if (!stats) return;
  $("stats").innerHTML =
    `Captured: <b>${stats.captured || 0}</b> · Sent: <b>${stats.sent || 0}</b> · New in queue: <b>${stats.added || 0}</b>` +
    (stats.lastError ? `<div class="err">Last error: ${stats.lastError}</div>` : "");
}

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    appUrl: $("appUrl").value.trim(),
    secret: $("secret").value.trim(),
    enabled: $("enabled").checked,
  });
  $("msg").innerHTML = '<span class="ok">Saved.</span>';
});

$("test").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    appUrl: $("appUrl").value.trim(),
    secret: $("secret").value.trim(),
    enabled: $("enabled").checked,
  });
  $("msg").textContent = "Testing…";
  chrome.runtime.sendMessage({ type: "RL_TEST_CONNECTION" }, (r) => {
    $("msg").innerHTML = r && r.ok
      ? '<span class="ok">Connected ✓</span>'
      : `<span class="err">Failed: ${(r && r.error) || "no response"}</span>`;
  });
});

setInterval(renderStats, 2000);
load();
