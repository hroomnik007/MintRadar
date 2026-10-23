# MintRadar ⚡

> Privacy-first monitoring for Cashu ecash mints — real-time status, reliability scoring, and decentralized discovery via Nostr.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Self-Hostable](https://img.shields.io/badge/self--hostable-yes-green.svg)](#-getting-started--self-hosting)
[![Open Source](https://img.shields.io/badge/open%20source-%E2%9D%A4-red.svg)](https://github.com/hroomnik007/MintRadar)

**Live:** [mintradar.org](https://mintradar.org)  
**About, privacy and rules:** [mintradar.org/about](https://mintradar.org/about)

---

## ✨ Features

### 📊 Real-Time Monitoring

- Probes all known mints every **5 minutes** via `/v1/info`
- A mint is ONLINE only if the endpoint answers with a successful HTTP status and valid JSON whose `nuts` field is an object
- Server-side latency measured from Nuremberg, DE (Hetzner Cloud)
- "Show my latency" button for a client-side test directly from your browser

### 🛡️ Reliability Score System

Composite score (0–100, in points, not a percentage) calculated server-side after every probe. Shown alongside a separate **Community Rating** (average of Nostr reviews), so a signal that does not come from the operator sits next to the objective one. This is a health / transparency score — it does not measure solvency or whether a mint can pay out.

Five components feed the score:

| Component | Basis |
|-----------|-------|
| Uptime | Availability over the last 24 hours |
| Audit Reliability | Share of the last 7 days' swaps whose failure [cashu.info](https://cashu.info) attributes to the mint. Too few swaps, no cashu.info data, or stale data scores a neutral middle value, not zero. audit.8333.space is not used for the score |
| NUT Support | Supported NUT specs, out of the set of mint-side NUTs MintRadar tracks |
| Version Freshness | How far the mint's software (Nutshell or cdk) is behind the newest stable release of the same software |
| Contact Info | Contact methods provided (email, Twitter, Nostr); capped, so a long contact list cannot inflate the score |

Mints that were discovered recently are capped below the maximum, even if every component is maxed.

The exact weights, audit bands, thresholds, cap and the change log are published on [mintradar.org/methodology](https://mintradar.org/methodology) (generated from the same constants the backend uses).

Interactive breakdown modal on each mint — hover any row for a tooltip explaining the scoring logic.

### 🔍 Dashboard & Discovery

- Search by name or URL
- Filter panel: Status (All / Online / Offline), Unit (SAT / USD / EUR, any of the selected), Reliability Score minimum, Hide test mints
- There is **no NUT filter** in the panel; the only way to filter by NUT is a `?nuts=` link (comma-separated NUT numbers, e.g. `?nuts=9,12`; a mint must support all of them), shown as dismissible `NUT-NN` tags
- Active filters shown as dismissible tags at the top of the open panel
- Dashboard state lives in the URL, so views can be shared as links: `?q=` (search), `?sort=` (`name`/`latency`/`rating`/`reliability`/`reviewCount`) with `?dir=` (`asc`/`desc`), `?status=` (`all`/`offline`), `?reliability=` (0–100), `?testmints=hide`, `?unit=` (`sat`, `usd`, `eur`, comma-separated, e.g. `?unit=sat,usd`) and `?compare=` (comma-separated mint URLs, also on the Watchlist page); default values are omitted
- Deep links: Mint Detail tabs open from the URL hash (`#overview`, `#history`, `#nuts`, `#audit`, `#reviews`, `#review-<id>`), and Tools from `/tools#pick` and `/tools#token`
- Counts: the header shows online and tracked mints; "tracked" is every mint in the database (archived ones included), and the grid footer reads "Showing X of <tracked>". Mints the default view hides (offline, degraded, archived) sit behind a "N mints hidden (offline 24h+)" toggle; **Show** reveals all of them
- Sort by Latency / Name / Reliability Score / **Rating** / **Most reviewed** (asc/desc) — Rating uses a confidence-adjusted average, (n·avg + 5·3.5) / (n + 5), so mints with few reviews rank lower and a mint with one 5★ review doesn't outrank one with eighty 4.8★ (the stars and counts shown do not change)
- Compact (list) and expanded (card) view toggle
- Single URL or bulk mint submission (paste multiple URLs at once)
- Recently discovered mints get a **New** badge; known dev/test mints are badged separately

### 📈 Historical Data

- Charts for **Latency**, **Uptime**, and **Reliability Score** over 24 h / 7 d / 30 d / 90 d
- Per-period averages for latency and uptime, with the change vs. the previous period
- Full Mint History panel with per-probe results
- **Audit tab** on each mint — swap data from two independent auditors, with a source switch (**cashu.info** / **8333.space**) when both have data. It opens on audit.8333.space when that data is present and fresh, and on cashu.info otherwise (the visitor can switch at any time). The 8333.space view has a summary strip (mints / melts / recent success rate / avg swap time), an outcome bar and a recent-swaps table; the cashu.info view shows the failures cashu.info attributes to the mint. The tab itself is display only: the Reliability Score's audit row always uses the stored cashu.info detail, and the breakdown shows a muted "data N days old" note when that detail is getting old

### 🌐 Global Stats

- The network right now: online mints out of tracked, average uptime, median latency, and the share of mints running outdated software
- Network Health Index (one score for the whole network, with its components)
- Top mints by Reliability Score and by uptime
- Software in use across known mints
- NUT coverage across the network
- Geographic distribution of the mints' servers
- Reliability movers — recent risers and fallers — and a Reliability Score trend chart

### ⚖️ Mint Comparison Tool

Compare up to **4** mints side-by-side: Status, Reliability Score, Community Rating, Uptime, Latency, NUT support grid, software version and its history. On narrow screens the table becomes a stacked/tabbed layout — one mint at a time, no horizontal scrolling.

### 👁️ Watchlist with Nostr Login

- Login via **NIP-07 browser extension**, **nsec private key**, or **NIP-46 bunker / Amber**
- Adding a mint to your watchlist requires a Nostr login (you're prompted to sign in first) — this keeps the list portable across devices
- The watchlist itself is stored locally (IndexedDB) and optionally synced across devices as **NIP-44 encrypted kind:10003** events on Nostr relays
- There is no JSON/CSV export: the list is the in-app watchlist plus optional Nostr sync
- Optional downtime/recovery DMs via Nostr (NIP-17 gift wrap). They can arrive even with the browser tab closed, at a Nostr client that supports private messages; delivery depends on relays and your client. The client registers via `POST /api/notifications/subscribe` (NIP-98) and the MintRadar notification service sends gift-wrapped DMs from its service key. Notifications are **off** for a newly watched mint: on the Watchlist card you turn on "Goes down" / "Goes up" yourself, and optionally any of the "More alerts" ("Mint/melt issues", "Version outdated", "Lost NUT04/05"), each one separately, and a pill shows as on only after the server confirmed the subscription (a failed request leaves it off and says so). Alerts are rate-limited per mint and per subscriber, so a flapping mint cannot flood your inbox. A DM contains only a fixed text, the mint's host name and a link to MintRadar, never text taken from the mint. Subscriber relays must use the standard web ports. A mint's URL is sent to the backend only while notifications are on for that mint — turn them off and the URL is not shared

### 📡 Nostr NIP-87 Discovery

Automatic mint discovery on a schedule from a set of public Nostr relays, using **kind:38172** mint announcements and **kind:38000** review events (URL mining), plus the audit.8333.space API — the sources run in parallel.

### 🔧 Tools

- **Token Inspector** — paste a Cashu token (`cashuA` / `cashuB`) to see its mint, amount, unit, proof count, memo, mint status, and Reliability Score, plus a signature check (NUT-12) — with a link to Mint Detail or Cashu.me. Optional **Check if spent** queries the mint (NUT-07) for unspent / spent / pending / partial proofs
- **Best Mint for Me** — a short wizard: pick your currency unit and how much you plan to store, then multi-select what matters (fast latency measured from your browser, Reliability Score, Lightning in + out, seed-phrase restore/NUT-09, locked payments (P2PK)/NUT-11, live WebSocket updates/NUT-17). The top matches show latency, uptime, Reliability Score, community rating, LN support, and mint/melt limits for the chosen unit

### 📚 Learn

A 5-module "Cashu 101" course, written as plain-language text with illustrated diagrams and key-takeaway callouts — no quizzes or progress tracking, just prev/next navigation between modules:

1. **Cashu Basics** — what Cashu is: the mint holds the Bitcoin, you hold a bearer token, and blind signatures keep transfers private
2. **Understanding the Risks** — why a mint can disappear or refuse to pay, why nobody can currently verify that a mint has real backing, and how to limit what you stand to lose
3. **How to Choose a Cashu Mint** — what to check (uptime, NUT support, software freshness, operator transparency) and how MintRadar's Reliability Score combines those signals
4. **Getting Started with a Wallet** — choosing a wallet, setting up your first mint, a first deposit, sending and receiving tokens, and backing up your wallet
5. **Day-to-day habits** — keeping your backup current, spreading funds across mints, checking before you commit, redeeming regularly and keeping an eye on your mints

### 👛 Wallet Directory

A hand-maintained list of Cashu-compatible wallets — each with supported platforms, a short description, and a link to the wallet's own site — plus a short section on running your own mint. No ranking or reviews.

### ⭐ Nostr-Based Reviews

Mint Detail shows community reviews as **kind:38000** events. On page load they're fetched live from a small fast relay set; a server-side sync additionally aggregates reviews from a broader relay set so counts and averages stay complete. Ratings are parsed from the review's rating tag or its `[N/5]` marker. Author profiles (name + avatar) are resolved from Nostr. Avatars are only loaded over HTTPS.

- Events with **neither a rating nor a comment** are not shown in the list and are not counted on mint cards
- Reviews from a key that is both listed as the mint's Nostr contact and the author of the mint's NIP-87 announcement are labelled and not counted in the Community Rating; a review from a key the mint lists only as a contact is counted and carries a neutral label
- Filter chips: **All**, **5★**, **Critical**, and a separate **Hide anon** toggle
- A short disclaimer notes these are unverified NIP-87 events from the open Nostr network
- Write your own review from the page, with a "Signing with …" indicator for the active login method

### 🔗 Social Link Previews

Sharing a mint page link on Twitter/X, Discord, Telegram, Slack, WhatsApp or Facebook shows a preview card with that mint's name, Reliability Score, and online status — server-rendered for link-preview crawlers that don't run JavaScript.

### 🔒 Privacy-First

- **No analytics, no tracking, no telemetry, no third-party scripts**
- **No cookies**
- Fonts are self-hosted — no requests to Google Fonts or any external font CDN
- Nostr private keys **never leave your browser** and are never stored or transmitted to the backend
- Token Inspector: a pasted token is decoded in your browser and never sent to MintRadar's servers. Verifying and "Check if spent" contact the mint named in the token; "Open in cashu.me" puts the token in the link's #fragment, which browsers do not send to servers, and "Redeem to Lightning" opens the redeem page without the token
- Watchlist data lives in your browser (IndexedDB) and optionally encrypted on Nostr relays under your own key; a mint's URL is additionally sent to MintRadar's backend only while you have notifications on for that mint, so it knows what to monitor for your downtime/recovery DMs

### 🔁 Automatic Backups

The hosted instance takes regular automatic database backups.

### 📎 Public API

Read-only JSON under `https://mintradar.org/api/`, including an API for wallets (`GET /api/v1/wallets/mints`). Rate-limited. See [MintRadar/docs/API.md](MintRadar/docs/API.md). How the score is computed (with its change log): [mintradar.org/methodology](https://mintradar.org/methodology); a quick start for wallet developers: [mintradar.org/for-wallets](https://mintradar.org/for-wallets). Signed health assertions (Nostr kind 30385) are published under the key health@mintradar.org: see [mintradar.org/for-wallets](https://mintradar.org/for-wallets#signed-health-assertions).

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + TypeScript + Vite 8
- TanStack Query v5, Zustand, Dexie (IndexedDB)
- Recharts, vite-plugin-pwa (PWA / offline support)
- nostr-tools (NIP-07, NIP-44, NIP-46 and the nsec login)
- Self-hosted open-source fonts: **DM Sans** and **JetBrains Mono**, plus the system `ui-monospace` stack for numeric/data values — no Google Fonts, no CDN

**Backend**
- Node.js 22 + Express 5 + TypeScript
- PostgreSQL 17 (via `pg`)
- nostr-tools for relay communication

**Deployment**
- Docker + Docker Compose (backend + PostgreSQL)
- Nginx (static frontend + `/api/*` reverse proxy)
- GitHub Actions CI

---

## 🔑 Nostr Login

Supported login methods:

- **NIP-07 extension** — e.g. [Alby](https://getalby.com/alby-extension), [nos2x](https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp) (Chrome/Edge), [nos2x-fox](https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/) (Firefox)
- **nsec** — paste your private key; it is held only in JavaScript memory for the session, never written to localStorage, sessionStorage or IndexedDB, and zeroed on logout
- **Amber / NIP-46 bunker** — connect via `bunker://` URI or NIP-05 identifier; also supports QR pairing with the Amber mobile app

---

## 🚀 Getting Started / Self-Hosting

### Prerequisites

- Node.js 22 or newer
- Docker and Docker Compose
- Nginx (for production deployments)

### 1. Clone

```bash
git clone https://github.com/hroomnik007/MintRadar.git
cd MintRadar/MintRadar
```

The frontend and backend source live in the `MintRadar/` subdirectory. The working directory for app code, Docker, and CI is `MintRadar/MintRadar`. The repository root holds only the README, LICENSE, SECURITY.md and repository config (`.github/` with CONTRIBUTING.md and the templates, `.gitignore`, `.gitleaks.toml`).

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
DATABASE_URL=postgresql://mintradar:yourpassword@postgres:5432/mintradar
ALLOWED_ORIGINS=http://localhost:5173
```

With Docker Compose the backend reaches PostgreSQL by its service name `postgres` (the database port is not published to the host). Compose also needs `POSTGRES_PASSWORD` (the same password as in `DATABASE_URL`), either exported in your shell or set in a `.env` file next to `docker-compose.yml`:

```bash
echo "POSTGRES_PASSWORD=yourpassword" > .env
```

### 3. Build and start the backend

```bash
(cd backend && npm ci && npm run build)
docker compose up -d
```

The backend image is built from the compiled `backend/dist/` (git-ignored), so the build must come first. `docker compose up -d` starts PostgreSQL and the backend API on port 3002 (bound to 127.0.0.1 only); `curl http://127.0.0.1:3002/health` answers once it is up.

### 4. Run the frontend

```bash
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server proxies `/api` to the backend on port 3002.

### Production build

```bash
npm run typecheck && npm run build
```

Serve the `dist/` directory with Nginx. See `MintRadar/deploy/nginx.conf` for the Nginx configuration of the hosted instance — it includes the security headers (CSP, HSTS, X-Frame-Options) and the `/api/` reverse proxy block.

### Private mode (`MINT_ALLOWLIST`)

To monitor a fixed set of mints (for example your own) and nothing else, set a comma-separated list of mint URLs in `backend/.env`:

```env
MINT_ALLOWLIST=https://mint.example.com,https://other-mint.example.org
```

Only `https://` entries count. An empty value, or a list without a single valid `https://` URL, means normal mode (the public behaviour is unchanged). At every start the listed mints are added to the database instead of the built-in public seed list.

While the list is active, the backend does not:

- discover mints (Nostr and API discovery, at start and every 6 hours);
- run the Nostr reviews sync (and the reviewer profile sync that rides on it);
- publish the daily service profile;
- publish the signed health assertions (Nostr kind 30385), even if `ATTESTATION_SERVICE_NSEC` is set;
- sync the cashu.info feed or its per-mint audit detail. The audit part of the Reliability Score is then neutral (its stored data, if any, goes stale and counts as neutral);
- refresh mint locations (daily and at start) or mint IP addresses.

`POST /api/mint/submit` and `GET /api/mint/probe` answer `403` for a URL that is not in the list, and `POST /api/mints/discover` answers `403` to every request.

What still leaves the server in this mode:

- Probing itself: every listed mint is contacted every 5 minutes, as always.
- The first successful probe of a mint without a stored location resolves its host and sends the IP address (not the hostname) to ipinfo.io.
- The contact entries a mint publishes in `/v1/info` are looked up in DNS (system resolver) to check that the domain exists.
- If Nostr DM notifications are enabled (`NOTIFICATION_SERVICE_NSEC`), a notification contains the mint's hostname and a `mintradar.org/mint/...` link with its URL, and it is published to Nostr relays. Leave `NOTIFICATION_SERVICE_NSEC` unset for a private deployment.
- With `NOTIFICATION_SERVICE_NSEC` set, the generic "MintRadar Alerts" service profile is also published once at start (it contains no mint data).

---

## 🔐 Security

MintRadar handles Nostr private keys and is used by the Bitcoin/Cashu community. To report a vulnerability, see **[SECURITY.md](SECURITY.md)**.

- No tracking or telemetry
- Nostr private keys are never sent to the server or written to browser storage; an nsec is held in memory for the session and zeroed on logout
- No `dangerouslySetInnerHTML`; user-controlled URLs are validated before rendering
- Backend SSRF protection (DNS pinning + blocked IP ranges), rate limiting, parameterized SQL
- The backend container runs as the unprivileged `node` user; the backend port is bound to the loopback interface and PostgreSQL is not published to the host
- HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR. See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

---

## 🔗 Links

- [MintRadar](https://mintradar.org)
- [Public API](MintRadar/docs/API.md)
- [Cashu Protocol](https://cashu.space)
- [Nostr Protocol](https://nostr.com)
- [NIP-87 — Mint Discovery](https://github.com/nostr-protocol/nips/blob/master/87.md)

---

## 📄 License

[MIT](LICENSE)

App code is MIT. The bundled webfonts (DM Sans, JetBrains Mono) are open-source fonts under their own licenses, self-hosted under `MintRadar/public/fonts/`.

---

**Built with ⚡ for the Cashu & Nostr community**
