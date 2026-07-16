# Handoff pack — Instagram Manager

Drop this folder's contents into a new chat (Fable 5 or any model) to fully brief it.

**Read in this order:**
1. `HANDOFF.md` — master brief: what the tool is, stack, DB, workers, env vars, files, roadmap, strategic findings, constraints.
2. `DISCOVERY.md` — deep dive on the newest subsystem: creator discovery pipeline, 24/7 worker, Chrome extension, reel format classification, auto-niche-on-scrape.
3. `SETUP-CHECKLIST.md` — exact steps to deploy and go live (what's done vs. what the user still needs to run).

The real code lives in the repo at `/Users/tomimiksa/Desktop/IG Scraper/instagram-manager`; the Chrome extension is in `extension/` (see `extension/README.md`). Everything type-checks (`npx tsc --noEmit` = 0) but is **not deployed yet** — one `railway up --detach` ships it.

Snapshot date: 2026-07.
