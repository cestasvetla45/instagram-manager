# Reel Lab — Creator Discovery Connector (Chrome extension)

Rides a logged-in Instagram profile and feeds every creator Instagram surfaces
to it — related profiles, "suggested for you", Explore/Reels feed authors —
into the app's discovery queue, where the 24/7 discovery worker vets them.

It is **passive**: it only observes the responses Instagram already sends to
the browser while you (or a VA) browse. It never clicks, follows, or requests
anything on Instagram's behalf, which keeps the discovery profile low-risk.

## Install (unpacked)
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the extension icon:
   - **App URL**: `https://instagram-tool-production-e4f2.up.railway.app`
   - **Ingest secret**: the `INGEST_SECRET` value you set in Railway.
   - **Test** → should show "Connected ✓". Save.

## Use
Log the browser profile into the discovery Instagram account, then just browse:
Explore, Reels, competitor profiles (open "similar accounts"), search results.
Everything IG suggests gets captured, deduped, and shipped in batches every
~20s. The popup shows captured / sent / new-in-queue counts.

Tip: the more the discovery account engages with tall-girl/fitness content,
the better IG's suggestions — and therefore the candidate queue — become.

## Server side
- `INGEST_SECRET` env var must be set in Railway (falls back to `CRON_SECRET`).
- Endpoint: `POST /api/discovery/ingest` (exempt from cookie auth; guarded by
  the secret — fail-safe rejects everything if auth is on but no secret set).
- Candidates land in the same `/discovery` review queue with sources
  `related` / `suggested` / `explore`.
