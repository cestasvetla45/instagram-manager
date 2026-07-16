// Isolated-world relay: page (inject.js) → background service worker.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data || ev.data.type !== "RL_DISCOVERY_USERS") return;
  try {
    chrome.runtime.sendMessage({
      type: "RL_DISCOVERY_USERS",
      source: ev.data.source,
      users: Array.isArray(ev.data.users) ? ev.data.users.slice(0, 400) : [],
      pageHandle: ev.data.pageHandle || "",
    });
  } catch {
    /* extension reloaded — page message dropped */
  }
});
