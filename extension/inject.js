// Runs in the page's MAIN world. Wraps fetch/XHR so every JSON response
// Instagram sends to this logged-in profile is scanned for creator handles.
// No requests are made on IG's behalf — purely passive observation of
// traffic the page generates itself while you browse.
(() => {
  const MSG = "RL_DISCOVERY_USERS";

  // Which endpoint produced the payload → discovery source label.
  function classify(url) {
    const u = String(url || "");
    if (/related_profiles|chaining|profiles\/see_all/i.test(u)) return "related";
    if (/discover|explore|clips\/home|clips\/discover|top_search/i.test(u)) return "explore";
    if (/suggested|su\/|ayml|fb_search/i.test(u)) return "suggested";
    if (/graphql|api\/v1/i.test(u)) return "suggested";
    return "";
  }

  // Deep-scan arbitrary JSON for IG user objects: {username, pk|id, ...}.
  function scanForUsers(node, out, depth) {
    if (!node || depth > 12 || out.size > 400) return;
    if (Array.isArray(node)) {
      for (const it of node) scanForUsers(it, out, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const uname = node.username;
    if (
      typeof uname === "string" &&
      /^[a-z0-9._]{2,30}$/i.test(uname) &&
      (node.pk || node.id || node.pk_id) &&
      (node.full_name !== undefined || node.profile_pic_url !== undefined || node.is_private !== undefined)
    ) {
      // Skip obviously-private accounts at the source — they can't be scraped.
      if (node.is_private !== true) out.add(uname.toLowerCase());
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") scanForUsers(v, out, depth + 1);
    }
  }

  function pageHandle() {
    const m = location.pathname.match(/^\/([A-Za-z0-9._]{2,30})\/?/);
    const seg = m ? m[1].toLowerCase() : "";
    return ["explore", "reels", "direct", "stories", "accounts", "p", "tv"].includes(seg) ? "" : seg;
  }

  function report(url, text) {
    const source = classify(url);
    if (!source) return;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    const users = new Set();
    scanForUsers(json, users, 0);
    if (users.size) {
      window.postMessage(
        { type: MSG, source, users: [...users], pageHandle: pageHandle(), href: location.href },
        window.location.origin
      );
    }
  }

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (classify(url)) {
        p.then((res) => {
          try {
            res.clone().text().then((t) => report(url, t)).catch(() => {});
          } catch {}
        }).catch(() => {});
      }
    } catch {}
    return p;
  };

  // XHR
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (classify(url)) {
        this.addEventListener("load", function () {
          try {
            if (typeof this.responseText === "string") report(url, this.responseText);
          } catch {}
        });
      }
    } catch {}
    return origOpen.call(this, method, url, ...rest);
  };
})();
