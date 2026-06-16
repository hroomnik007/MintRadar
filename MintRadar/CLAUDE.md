# MintRadar — Claude Code Context

## Project
Privacy-first Cashu mint monitoring PWA.
Live: https://mintradar.pedani.eu
GitHub: https://github.com/hroomnik007/MintRadar

## Server
Sensitive values are in CLAUDE.local.md (gitignored) — ask the developer

- VPS: $VPS_HOST, user: $VPS_USER
- Frontend: $VPS_DIST_PATH (served by Nginx)
- Repo: $VPS_REPO_PATH
- Backend: Node/Express, port $BACKEND_PORT, Docker
- DB: PostgreSQL in Docker ($DB_NAME, user: $DB_USER)

## Stack
- Frontend: React 18 + TypeScript + Vite 5 + TanStack Query v5 + Zustand + Dexie (IndexedDB) + Recharts + vite-plugin-pwa
- Backend: Node.js/Express + TypeScript + pg (PostgreSQL) + nostr-tools
- Auth: Nostr NIP-07 (nos2x-fox, Alby)
- Fonts: DM Sans (self-hosted variable font)
- CSS: CSS variables (var(--bg), var(--bg2), var(--accent) #17E87F, var(--border), var(--text), var(--text2), var(--text3))

## Architecture
- Personal watchlist → IndexedDB only (never on server, cleared on logout)
- Public mint history → PostgreSQL (mint_history table)
- Mint discovery → NIP-87 kind:38172 server cron every 6h + client-side after Nostr login
- Backend proxy → /api/* proxied by Nginx to localhost:3002
- Cron every 5min → probes all mints via /v1/info → writes to mint_history
- Online status: mint is ONLINE only if /v1/info returns HTTP 200 with valid JSON containing `nuts` field
- Nostr DM notifications → browser-side via NIP-07 when watchlist mint goes down/up
- Reviews → NIP-87 kind:38000 events, read/write directly from browser via Nostr relays

## DB Tables

### mints
```
url TEXT PRIMARY KEY
name TEXT
discovered_at TIMESTAMPTZ DEFAULT NOW()
is_known BOOLEAN DEFAULT FALSE
icon_url TEXT
version TEXT
nut_count INTEGER
tos_url TEXT
description_long TEXT
nuts_limits JSONB
audit_n_mints INTEGER
audit_n_melts INTEGER
audit_n_errors INTEGER
audit_checked_at TIMESTAMPTZ
last_trust_score INTEGER
last_error TEXT
```

### mint_history
```
id BIGSERIAL PRIMARY KEY
url TEXT REFERENCES mints(url) ON DELETE CASCADE
online BOOLEAN NOT NULL
latency_ms INTEGER
checked_at TIMESTAMPTZ DEFAULT NOW()
```
Index: (url, checked_at DESC)

### mint_version_history
```
id BIGSERIAL PRIMARY KEY
url TEXT REFERENCES mints(url) ON DELETE CASCADE
version TEXT NOT NULL
first_seen_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE (url, version)
```

## Backend API
- GET /health — health check
- GET /api/mints/known — all mints with online status, latency, trust score, degraded flag (TTL cached 60s)
- GET /api/mints/history?url=&period={24h|7d|30d|90d} — bucketed uptime/latency segments + prev period trend
- GET /api/mints/version-history?url= — per-mint software version timeline + latest global version
- GET /api/mints/daily-uptime?url= — daily uptime counts for last 30 days
- GET /api/stats — network-wide stats: totalMints, onlineMints, offlineMints, avgTrustScore, avgLatency24h, trustDistribution, nutAdoption, top5ByTrustScore
- GET /api/mint/probe?url= — on-demand probe of a single mint URL
- POST /api/mint/submit — submit new mint URL { url: string }, rate limited 20/IP/hr
- POST /api/mints/discover — batch insert discovered URLs { urls: string[] }, rate limited 10/IP/hr

## /api/stats calculation rules
- totalMints: mints where latest online IS NOT FALSE (online=true or null) — matches Dashboard "Known Mints"
- onlineMints: mints where latest online = true
- offlineMints: totalMints - onlineMints
- avgTrustScore: average of (last_trust_score ?? 0) for online mints only — matches Dashboard calculation
- trustDistribution: low/moderate/high counts from online mints only (same filter as avgTrustScore)

## Trust Score calculation (server-side, in prober.ts)
- Uptime 45%: uptimePct * 0.45 (from 24h mint_history)
- NUT Support 30%: min(nutCount/14, 1) * 30
- Version freshness 15%: based on Nutshell version recency
- Audit reliability 5%: based on error rate from audit_n_errors/(audit_n_mints+audit_n_melts+audit_n_errors)
- Stored in mints.last_trust_score after each probe

## Cron jobs
- Every 5min: probe all mints in DB → write to mint_history, update mints metadata + last_trust_score
- Every 6h: NIP-87 discovery from 7 relays + audit.8333.space API → INSERT new mints

## Discovery relays (backend + frontend)
wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net,
wss://relay.cashumints.space, wss://relay.azzamo.net,
wss://purplepag.es, wss://relay.snort.social

## Key features
- Dashboard: compact/expanded card view, advanced filter panel (Status/TrustScore/Age/NUTs), search, sort, mint comparison tool (up to 4), stats bar, submit form (single + bulk)
- Mint Detail: MOTD, NUT compatibility grid with modal, NUT limits (NUT-04/05), historical charts (24h/7d/30d/90d, Latency/Uptime/Trust), Mint History panel, version history, Trust Score gauge with breakdown, Audit stats, Add to Wallet + QR, NIP-87 reviews, mint age badges, backup checker (NUT-13)
- Stats page: totalMints/onlineMints/offlineMints/avgTrustScore/avgLatency cards, NUT adoption horizontal bars (color-coded), Trust Score donut chart, Top 5 by Trust Score
- Watchlist: IndexedDB only, Nostr login required, export JSON/CSV, DM notifications (NIP-07)
- Nostr: NIP-07 login, profile fetch (kind:0), reviews (kind:38000), DM notifications (kind:4), watchlist sync (NIP-44 kind:10003)

## Deploy workflow (ALWAYS do all steps)
See CLAUDE.local.md for $VPS_HOST, $VPS_USER, $VPS_REPO_PATH, $VPS_DIST_PATH values.

Backend (only if backend changed):
1. Commit + push local changes: git add -A && git commit -m "..." && git push origin main
2. On server pull + build: ssh $VPS_USER@$VPS_HOST "cd $VPS_REPO_PATH && git pull origin main && cd backend && npm run build"
3. Rebuild + restart Docker image: ssh $VPS_USER@$VPS_HOST "cd $VPS_REPO_PATH && docker compose build backend && docker compose up -d backend"
   NOTE: `docker compose restart` does NOT pick up code changes — always use `build` + `up -d`

Frontend:
4. Build frontend: npm run typecheck && npm run build
5. Deploy: rsync -avz --delete dist/ $VPS_USER@$VPS_HOST:$VPS_DIST_PATH/
6. Reload nginx: ssh $VPS_USER@$VPS_HOST "sudo systemctl reload nginx"
7. Commit: git add -A && git commit -m "type: description" && git push origin main

## Key rules
- NEVER modify anything not explicitly requested
- ALWAYS run typecheck before build
- ALWAYS rsync dist after build
- ALWAYS commit and push after deploy
- Conventional commits: feat:, fix:, refactor:, docs:, chore:
- Security: always audit new code for SSRF, rate limits, XSS
