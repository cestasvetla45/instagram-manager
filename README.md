# Reel Lab — Instagram Manager

A comprehensive Instagram management platform for scraping, analyzing, categorizing, and tracking viral content across hundreds of accounts.

**Live:** https://instagram-tool-production-e4f2.up.railway.app
**Repo:** https://github.com/cestasvetla45/instagram-manager

---

## 📊 Pages

### Overview
| Page | URL | Description |
|------|-----|-------------|
| **Overview** | `/` | Combined stats, recent reels, bot status |
| **Accounts Dashboard** | `/dashboard` | CRM-style dashboard with KPI cards, views-over-time chart with post markers, date filters (7d/30d/90d/all), per-account table, recent reels grid |
| **Growth** | `/growth` | Follower growth charts over time |
| **Analytics** | `/analytics` | Engagement analytics and breakdowns |
| **Admin Dashboard** | `/admin` | Real-time system health: API calls/min, success rate, worker batch history, database stats, environment status. Auto-refreshes every 10s |

### 🔥 Inspiration
| Page | URL | Description |
|------|-----|-------------|
| **Trending Models** | `/trending-models` | Viral creators leaderboard — sorted by total views, viral count, or viral rate. Top 3 reels per model with thumbnails. Filter by niche and time window (24h/7d/30d) |
| **Inspiration Library** | `/inspiration-library` | 4 tabs: Bulk Import (paste hundreds of links), Gallery (filter/sort/search reels), Trending (viral reels, rising niches), Niche Dashboard (per-niche stats) |
| **Inspiration Accounts** | `/inspiration-accounts` | 3 tabs: Accounts (399 accounts, bulk delete, add), Reels (bulk delete, tray move), Stats Overview (top accounts, niche distribution) |
| **Inspiration Reels** | `/inspiration` | Reel grid with bulk select + delete, niche/tray/viral filters, ReelCard with thumbnails |
| **Inspiration Generator** | `/generate` | Generate concepts from inspiration reels |
| **Creator Discovery** | `/discovery` | Discover new creators via co-author detection |
| **Top Reels** | `/top-reels` | Top performing reels across all accounts |
| **Comment Intelligence** | `/comments` | Analyze comments for engagement signals |

### 🎬 Content
| Page | URL | Description |
|------|-----|-------------|
| **Content Pipeline** | `/pipeline` | 4 tabs: Concepts, Briefs, Assign, VA Posting. 14-day cooldown enforcement, no same-concept-on-account rule |
| **Content Vault** | `/vault` | Store and manage content assets |
| **Add / Scrape** | `/add` | Scrape individual reels or accounts |

### 📋 Accounts
| Page | URL | Description |
|------|-----|-------------|
| **Our Reels** | `/our-reels` | All reels from your accounts with stats |
| **Reel Performance** | `/performance` | 3 tabs: Performance Tracker (retention, demographics, AI feedback), Winner Templates (patterns from winning reels), Trends (what's working/not working) |
| **VA Management** | `/va-management` | 5 tabs: Overview Dashboard, VAs & Assignments, Posting Schedule, Posting Log, Instagram Connect |
| **VA Daily** | `/va` | VA daily checklist (15 tasks per account) |

### ⚙️ Settings
| Page | URL | Description |
|------|-----|-------------|
| **Telegram Bot** | `/telegram` | Bot status, webhook info, command reference |
| **Telegram Users** | `/telegram-users` | Manage authorized users (admin/content/va roles) |
| **Users & Access** | `/users` | App user management |
| **Beta Features** | `/beta-features` | Feature flags |

### 📱 Mobile Pages
| Page | URL | Description |
|------|-----|-------------|
| **Connect Instagram** | `/connect` | Mobile-first Instagram OAuth connection page |
| **Stats Input** | `/stats` | Mobile-first manual stats input — select account, edit reel stats |

---

## 🤖 Telegram Bot (@igorvisbot)

### Commands
| Command | Role | Description |
|---------|------|-------------|
| `/help` | all | Show all available commands |
| `/stats [@handle]` | admin, va | Account stats (followers, views, growth) |
| `/posted [@handle]` | admin, va | Check which accounts posted today |
| `/viralaccounts` | admin, content, va | Which of your accounts have viral content |
| `/niches` | admin, content, va | Top viral niches right now |
| `/trending` | admin, content, va | Top viral reels right now |
| `/viral` | admin, content, va | Fresh viral from last 24h |
| `/niche` | admin, content | Data-driven niche recommendation |
| `/library` | admin, content | Inspiration library stats |
| `/perf [@handle]` | admin, content, va | Recent reel performance |
| `/winners` | admin, content, va | Current winning reel templates |
| `/feedback <reel_url>` | admin, content, va | AI feedback for a specific reel |
| `/inspire` | admin, content | Bulk import inspiration reels/links |
| `/vacheck` | admin | Did VAs do their job today? |
| `/banned` | admin | Check if any accounts are banned/inaccessible |
| `/notifybans` | admin | Toggle auto ban notifications |
| `/assign <handle> <va>` | admin | Assign account to VA |
| `/unassign <handle>` | admin | Unassign account from VA |
| `/vas` | admin | List all VAs and their accounts |
| `/schedule <handle>` | admin | Show posting schedule for an account |
| `/adduser <id> <role>` | admin | Authorize a user (admin/content/va) |
| `/users` | admin | List authorized users |
| `/removeuser <id>` | admin | Remove a user |

### Conversational AI
Send any natural language message (not a command) and the bot responds using Gemini with your real data. Examples:
- "did the VAs post today?"
- "what niche should I focus on?"
- "which account is doing best?"
- "what's trending right now?"

### Photo Handling
VAs can send analytics screenshots → bot downloads, stores in Supabase, asks which reel → attaches → auto-analyzes at 2+ screenshots → replies with AI summary.

---

## ⚙️ Worker (Background Processor)

Runs continuously (every 30 seconds) with per-account 60-minute cooldown:

| Function | Frequency | Description |
|----------|-----------|-------------|
| **Account Stats Refresh** | Every batch | Scrape all reels per account via bulk API, update views/likes/comments |
| **Per-Reel Fallback** | When bulk fails | If bulk scrape returns 0, scrape each reel individually |
| **New Reel Ingestion** | Every batch | Auto-discovers new reels from inspiration accounts and ingests them |
| **Viral Auto-Discovery** | Every batch | Flags reels crossing viral threshold (>100K views + 5x view/follow ratio) |
| **Virality Recalculation** | Every 10 batches | Recalculates viral_score, trend_velocity, is_viral for 100 reels |
| **Gemini Categorization** | Every 2 batches | Auto-categorizes reels with video_url — assigns niche, sub_category, format. 2-second delay between calls |
| **Backlog Enrichment** | Every 5 batches | Scrapes new inspiration accounts that have no reels yet |
| **Account Snapshots** | Every 20 batches | Logs follower count, total views, reel count per account |
| **New Post Detection** | Every 5 batches | Checks our accounts for newly posted reels |
| **Inaccessible Flagging** | Automatic | If all scrape calls fail for an account, flags as `scrape_status: "inaccessible"` and skips it |

### API Rate Limiting
- Dual API key rotation (350/min + 50/min = 400/min total)
- 150ms delay between all API calls
- Automatic retry with exponential backoff on 429s

---

## 🔌 API Routes

### Reels & Accounts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reels?type=our\|inspiration` | List reels with filters (handle, niche, tray, viral, sort, limit) |
| PATCH | `/api/reels/update` | Manually update reel stats (views, likes, comments, shares, saves) |
| GET | `/api/accounts?type=our\|inspiration` | List accounts with followers, niche, etc. |
| GET | `/api/account-snapshots` | Snapshot history (followers, views, reel count over time) |

### Inspiration Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inspiration-accounts` | List accounts with reel counts, avg views, viral count |
| POST | `/api/inspiration-accounts` | Add a new inspiration account (scrapes profile) |
| DELETE | `/api/inspiration-accounts` | Bulk delete accounts + their reels |
| DELETE | `/api/inspiration-accounts/[handle]` | Delete single account + reels |
| GET | `/api/inspiration-accounts/stats` | Stats overview (top accounts, niche distribution) |
| GET | `/api/inspiration-reels/manage` | Paginated reels with filters |
| DELETE | `/api/inspiration-reels/manage` | Bulk delete reels |
| POST | `/api/inspiration-reels/manage` | Bulk move reels to different tray |
| POST | `/api/inspiration-reels/fix-thumbnails` | Backfill missing thumbnails |
| POST | `/api/inspiration-reels/backfill` | Backfill missing captions |

### Inspiration Library
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inspiration-library` | Sub-categories, trays, niches |
| GET | `/api/inspiration-library/trending` | Viral reels, rising niches, opportunities |
| POST | `/api/inspiration-library/categorize` | Run Gemini categorization on untagged reels |
| POST | `/api/inspiration-library/calc-viral` | Recalculate virality scores |
| POST | `/api/inspiration-library/tag` | Bulk tag reels with niche/sub-category/tray |

### Trending Models
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trending-models` | Viral creators leaderboard with top reels |

### Niches
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/niches` | List all niches |
| POST | `/api/niches` | Create a new niche |

### Content Pipeline
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/taxonomy` | Content types + subniches |
| GET/POST | `/api/pipeline/concepts` | CRUD for concepts |
| GET/POST | `/api/pipeline/briefs` | CRUD for briefs with cooldown annotation |
| POST | `/api/pipeline/assign` | Create assignment (14-day cooldown + same-concept enforcement) |
| GET | `/api/pipeline/check` | VA view of available-to-post, on-cooldown, recently posted |

### Reel Performance
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reel-performance` | Performance data with filters |
| POST | `/api/reel-performance/analyze` | Run AI analysis (24h auto-analysis) |
| GET | `/api/reel-performance/trends` | Trend identification + winner templates |
| GET/POST | `/api/reel-performance/winners` | Winner templates + inspiration generation |

### Instagram Graph API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instagram-graph/connect` | Get OAuth URL for Instagram connection |
| GET | `/api/instagram-graph/callback` | OAuth callback handler |
| GET | `/api/instagram-graph/accounts` | List connected accounts |
| POST | `/api/instagram-graph/sync` | Sync insights for connected accounts |
| POST | `/api/instagram-graph/disconnect` | Disconnect an account |

### VA Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PATCH/DELETE | `/api/va-management` | VA profiles CRUD |
| GET/POST/DELETE | `/api/va-management/assign` | Account assignments |
| GET/POST/PATCH/DELETE | `/api/va-management/schedule` | Posting schedule slots |
| GET | `/api/va-management/dashboard` | Aggregated dashboard data |
| GET/PATCH | `/api/va-management/log` | Posting log with status |
| GET/POST/PATCH/DELETE | `/api/va/accounts` | VA account management |
| GET/POST | `/api/va/checklist` | Daily checklist |
| GET/POST | `/api/va/plan` | VA plan |
| GET/POST | `/api/va/posts` | Post tracking |
| GET/POST | `/api/va/trials` | VA trials |
| GET/POST | `/api/va/vault` | VA vault |

### Telegram
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/telegram/webhook/[secret]` | Webhook handler (all commands + conversational AI + photo handling) |
| GET | `/api/telegram/setup` | Register webhook |
| GET | `/api/telegram/status` | Bot status |
| GET | `/api/telegram-users` | Manage authorized users |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Real-time system stats (API calls, worker cycles, database health, env status) |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | System status (airtable, rocksolid configured) |
| POST | `/api/scrape` | Scrape a single reel |
| POST | `/api/scrape-profile` | Scrape a profile |
| POST | `/api/inspiration/scrape-account` | Scrape an account's reels |
| POST | `/api/inspiration/bulk-add` | Bulk add inspiration accounts |
| POST | `/api/inspiration/tag` | Tag inspiration reels |
| POST | `/api/inspiration/ai-categorize` | AI categorize inspiration reels |
| POST | `/api/download` | Download a reel video |
| POST | `/api/refresh` | Trigger refresh cycle |
| POST | `/api/enrich` | Enrich inspiration account |
| POST | `/api/migrate` | Run SQL migration (internal) |
| GET | `/api/discovery/*` | Creator discovery endpoints |
| GET | `/api/analyze-comments` | Comment analysis |

---

## 🗄️ Database (Supabase / PostgreSQL)

### Core Tables
| Table | Description |
|-------|-------------|
| `our_accounts` | Your Instagram accounts (handle, followers, niche, scrape_status) |
| `our_reels` | Reels from your accounts (views, likes, comments, shares, saves, thumbnail, video_url) |
| `inspiration_accounts` | Tracked inspiration accounts (399 accounts) |
| `inspiration_reels` | Scraped inspiration reels (5,000+, with viral_score, trend_velocity, is_viral, niche, sub_category, tray) |
| `account_snapshots` | Historical snapshots (followers, total views, reel count over time) |
| `niches` | Niche definitions |
| `sub_categories` | Sub-category definitions |

### Pipeline Tables
| Table | Description |
|-------|-------------|
| `content_types` | Talking vs dance |
| `subniches` | Dance subniches (twerk, sensual, etc.) |
| `content_concepts` | Reel concepts |
| `content_briefs` | Detailed briefs for concepts |
| `content_assignments` | Account-to-concept assignments with 14-day cooldown |

### Performance Tables
| Table | Description |
|-------|-------------|
| `reel_performance` | Deep insights (retention, reach, saves, shares, watch-time, demographics, AI feedback) |
| `winner_templates` | Patterns distilled from winning reels |

### VA Tables
| Table | Description |
|-------|-------------|
| `va_profiles` | VA profiles (name, role, telegram_id, max_accounts) |
| `account_assignments` | Account-to-VA assignments |
| `posting_schedule` | Per-account posting time slots |
| `va_posts` | Post tracking log (status: posted/missed/failed) |
| `va_checklist` | Daily checklist progress |

### Telegram Tables
| Table | Description |
|-------|-------------|
| `telegram_users` | Authorized users (telegram_id, role, is_active) |
| `app_settings` | App settings (notify_bans toggle) |

### Graph API Tables
| Table | Description |
|-------|-------------|
| `instagram_tokens` | Connected Instagram accounts (ig_account_id, access_token, token_expires_at) |

---

## 🔧 Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 14 (App Router), React, Recharts |
| Backend | Next.js API Routes (Node.js) |
| Database | Supabase (PostgreSQL) |
| Worker | Railway background worker (tsx) |
| Hosting | Railway (2 services: instagram-tool + worker) |
| Instagram Scraper | RockSolidAPIs (dual API keys, 400 calls/min) |
| AI Categorization | Google Gemini (gemini-3.5-flash for video, gemini-2.5-flash for text) |
| Telegram Bot | @igorvisbot (webhook mode, conversational AI via Gemini) |
| Instagram Graph API | OAuth flow for deep insights (retention, demographics) |
| Version Control | GitHub (https://github.com/cestasvetla45/instagram-manager) |

---

## 🚀 Deploy

```bash
# Build
npm run build

# Deploy both services
railway up --service instagram-tool --detach
railway up --service worker --detach

# Re-register Telegram webhook
curl https://instagram-tool-production-e4f2.up.railway.app/api/telegram/setup
```

### Environment Variables
| Variable | Service | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | both | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | both | Supabase service role key |
| `ROCKSOLID_API_KEY` | both | Primary RockSolidAPIs key (350/min) |
| `ROCKSOLID_API_KEY_2` | both | Secondary RockSolidAPIs key (50/min) |
| `GEMINI_API_KEY` | both | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | both | Telegram bot token |
| `TELEGRAM_WEBHOOK_SECRET` | both | Webhook secret |
| `TELEGRAM_ADMIN_ID` | both | Admin's Telegram user ID |
| `META_APP_ID` | both | Meta app ID for Graph API |
| `META_APP_SECRET` | both | Meta app secret for Graph API |
| `ENRICH_PER_CYCLE` | worker | Accounts to scrape per backlog batch (default 40) |
| `ENRICH_REELS_PER_ACCOUNT` | worker | Reels to save per account (default 25) |
