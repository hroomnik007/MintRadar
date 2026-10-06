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
- A mint is ONLINE only if the endpoint returns HTTP 200 with valid JSON containing a `nuts` field
- Server-side latency measured from Nuremberg, DE (Hetzner Cloud)
- "Show my latency" button for a client-side test directly from your browser

### 🛡️ Reliability Score System

Composite score (0–100) calculated server-side after every probe. Shown alongside a separate **Community Rating** (average of Nostr reviews), so an operator-independent signal sits next to the objective one. This is a health / transparency score — it does not measure solvency or whether a mint can pay out.

| Component | Weight | Basis |
|-----------|--------|-------|
| Uptime | 40% | 24 h availability |
| NUT Support | 15% | Supported NUT specs (out of the tracked mint-side set) |
| Version Freshness | 15% | Recency of the mint's software release (Nutshell or cdk) vs. latest known version |
| Contact Info | 5% | Contact methods provided (email, Twitter, Nostr); capped at 3 channels |
| Audit Reliability | 25% | Rolling-window error rate on the last ~100 real swaps from audit.8333.space. Fewer than 3 samples scores a neutral 12.5, not zero; the score is not adjusted for how old the audit data is |

Mints discovered less than **30 days** ago are **capped at 75**, even if every component is maxed.

Interactive breakdown modal on each mint — hover any row for a tooltip explaining the scoring logic.

### 🔍 Dashboard & Discovery

- Search by name or URL
- Filter panel: Status (All / Online / Offline), Unit (SAT / USD / EUR, any of the selected), Reliability Score minimum, Hide test mints
- There is **no NUT filter** in the panel; the only way to filter by NUT is a `?nuts=` link (comma-separated NUT numbers, e.g. `?nuts=9,12`; a mint must support all of them), shown as dismissible `NUT-NN` tags
- Active filters shown as dismissible tags at the top of the open panel
- Dashboard state lives in the URL, so views can be shared as links: `?q=` (search), `?sort=` (`name`/`latency`/`rating`/`reliability`/`reviewCount`) with `?dir=` (`asc`/`desc`), `?status=` (`all`/`offline`), `?reliability=` (0–100), `?testmints=hide`, `?unit=` (`sat`, `usd`, `eur`, comma-separated, e.g. `?unit=sat,usd`) and `?compare=` (2–4 comma-separated mint URLs, also on the Watchlist page); default values are omitted
- Deep links: Mint Detail tabs open from the URL hash (`#overview`, `#history`, `#nuts`, `#audit`, `#reviews`, `#review-<id>`), and Tools from `/tools#pick` and `/tools#token`
- Counts: the header shows online and tracked mints; "tracked" is every mint in the database (archived ones included), and the grid footer reads "Showing X of <tracked>". Mints the default view hides (offline, degraded, archived) sit behind a "N mints hidden (offline 24h+)" toggle; **Show** reveals all of them
- Sort by Latency / Name / Reliability Score / **Rating** / **Most reviewed** (asc/desc) — Rating uses a weighted (Bayesian) average so a mint with two 5★ reviews doesn't outrank one with fifty
- Controls row stays docked at the top of the list while you scroll
- Compact and expanded card view toggle
- Single URL or bulk mint submission (paste multiple URLs at once)
- Recently discovered mints get a **New** badge (first 30 days); known dev/test mints are badged separately and kept out of recommendations

### 📈 Historical Data

- Charts for **Latency**, **Uptime**, and **Reliability Score** over 24 h / 7 d / 30 d / 90 d
- Per-period averages with delta vs. previous period
- Full Mint History panel with per-probe results
- **Audit tab** on each mint — a summary strip (mints / melts / recent success rate / avg swap time) backed by real swap data from audit.8333.space, with an amber/red reliability signal based on the rolling error rate. When the audit data is stale, a muted note on the Reliability Score breakdown row shows the age; the score itself is not adjusted.

### 🌐 Global Stats

- Network-wide totals: online/offline counts, average reliability score, average latency
- Reliability Score distribution
- Top mints by Reliability Score
- NUT adoption across the network
- Software in use across known mints
- Reliability movers — recent risers and fallers

### ⚖️ Mint Comparison Tool

Select 2–4 mints and compare side-by-side: Status, Reliability Score, Community Rating, Uptime, Latency, NUT support grid, software version. On narrow screens the table becomes a stacked/tabbed layout — one mint at a time, no horizontal scrolling.

### 👁️ Watchlist with Nostr Login

- Login via **NIP-07 browser extension**, **nsec private key**, or **NIP-46 bunker / Amber**
- Adding a mint to your watchlist requires a Nostr login (you're prompted to sign in first) — this keeps the list portable across devices
- Watchlist itself is stored locally (IndexedDB) and optionally synced across devices as **NIP-44 encrypted kind:10003** events on Nostr relays
- **No JSON/CSV export.** The list is the in-app watchlist plus optional Nostr sync — there is no download/export button
- Downtime/recovery DMs via Nostr (NIP-17 gift wrap). They can arrive **even with the browser tab closed**, at a Nostr client that supports private messages (NIP-17; delivery is not guaranteed): the client registers via `POST /api/notifications/subscribe` (NIP-98) and the MintRadar notification service sends gift-wrapped DMs from its service nsec. Notifications are **off** for a newly watched mint: on the Watchlist card you turn on "Goes down" / "Goes up" yourself, and a pill shows as on only after the server confirmed the subscription (a failed request leaves it off and says so). At most one DM per mint and direction per hour. A mint's URL is sent to the backend only while notifications are on for that mint — turn them off and the URL is not shared

### 📡 Nostr NIP-87 Discovery

Automatic mint discovery on a schedule from a set of public Nostr relays, using **kind:38172** mint announcements and **kind:38000** review events (URL mining), plus the **audit.8333.space** API — sources running in parallel.

### 🔧 Tools

- **Token Inspector** — paste a Cashu token (`cashuA` / `cashuB`) to see its mint, amount, unit, proof count, memo, mint status, and Reliability Score, plus a signature check (NUT-12) — with a link to Mint Detail or Cashu.me. Optional **Check if spent** queries the mint (NUT-07) for unspent / spent / pending / partial proofs
- **Best Mint for Me** — 2-step wizard: pick your currency unit and how much you plan to store, then multi-select what matters (fast latency measured from your browser, Reliability Score, Lightning in + out, seed-phrase restore/NUT-09, locked payments (P2PK)/NUT-11, live WebSocket updates/NUT-17). The top matches show latency, uptime, Reliability Score, LN support, and mint/melt limits for the chosen unit

### 📚 Learn

A 5-module "Cashu 101" course, written as plain-language text with custom illustrated diagrams and highlighted key-takeaway callouts — no quizzes or progress tracking, just prev/next navigation between modules:

1. **Cashu Basics** — what Cashu actually is: the mint holds your Bitcoin, you hold a bearer token, and blind signatures keep person-to-person transfers private
2. **Understanding the Risks** — why a mint can disappear or refuse to pay, why nobody can currently verify a mint has real backing, and how to limit what you stand to lose
3. **How to Choose a Mint** — what to check before trusting a mint (uptime, audit reliability, software version, operator transparency) and how MintRadar's Reliability Score combines those signals
4. **Getting Started with a Wallet** — choosing a wallet, adding your first mint, making a deposit, sending tokens, and why backing up your seed phrase is non-negotiable
5. **Safe Habits** — day-to-day habits (diversifying mints, redeeming regularly, checking Reliability Score first) that meaningfully reduce your risk

### 👛 Wallet Directory

A hand-maintained list of Cashu-compatible wallets — each with supported platforms, a short description, and a link to the wallet's own site. No ranking, reviews, or affiliate links.

### ⭐ Nostr-Based Reviews

Mint Detail page shows community reviews as **kind:38000** events. On page load they're fetched live from a small fast relay set; a server-side sync additionally aggregates reviews from a broader relay set so counts and averages stay complete. Ratings are parsed from review text (`[N/5]` format). Author profiles (name + avatar) are resolved from Nostr. Images are only loaded over HTTPS.

- Events with **neither a rating nor a comment** are not shown in the list and are not counted on mint cards
- Filter chips: **All**, **5★**, **Critical** (≤ 2★), and a separate **Hide anon** toggle
- A short disclaimer notes these are unverified NIP-87 events from the open Nostr network, not vetted testimonials
- Write your own review from the page, with a "Signing with …" indicator for the active login method

### 🔗 Social Link Previews

Sharing a mint page link on Twitter/X, Discord, Telegram, Slack, or WhatsApp shows a preview card with that mint's name, Reliability Score, and online status — server-rendered for link-preview crawlers that don't run JavaScript.

### 🔒 Privacy-First

- **No analytics, no tracking, no telemetry, no third-party scripts**
- **No cookies**
- Fonts are self-hosted — no requests to Google Fonts or any external font CDN
- Nostr private keys **never leave your browser** and are never stored or transmitted to the backend
- Token Inspector: a pasted token is decoded in your browser and never sent to MintRadar's servers. Verifying and "Check if spent" contact the mint named in the token; "Open in cashu.me" puts the token in the link's #fragment, which browsers do not send to servers, and "Redeem to Lightning" opens the redeem page without the token
- Watchlist data lives in your browser (IndexedDB) and optionally encrypted on Nostr relays under your own key; a mint's URL is additionally sent to MintRadar's backend only while you have notifications on for that mint, so it knows what to monitor for your downtime/recovery DMs

### 🔁 Automatic Backups

PostgreSQL database backed up every 6 hours via server cron.

### 📎 Public API

Read-only JSON under `https://mintradar.org/api/` (for example `GET /api/mints/known`). Rate-limited. See [docs/API.md](docs/API.md).

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + TypeScript + Vite 8
- TanStack Query v5, Zustand, Dexie (IndexedDB)
- Recharts, vite-plugin-pwa (PWA / offline support)
- nostr-tools (NIP-07, NIP-44, NIP-46), @noble/secp256k1
- Self-hosted open-source fonts: **DM Sans** and **JetBrains Mono** (both SIL Open Font License 1.1), plus the system `ui-monospace` stack for numeric/data values — no Google Fonts, no CDN

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

Three login methods are supported:

- **NIP-07 extension** — [Alby](https://getalby.com/alby-extension) (recommended), [nos2x](https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp) (Chrome/Edge), [nos2x-fox](https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/) (Firefox)
- **nsec** — paste your private key; it is held only in JavaScript memory for the session, never written to localStorage, sessionStorage or IndexedDB, and zeroed on logout
- **Amber / NIP-46 bunker** — connect via `bunker://` URI or NIP-05 identifier; also supports QR pairing with the Amber mobile app

---

## 🚀 Getting Started / Self-Hosting

### Prerequisites

- Node.js 22+
- Docker and Docker Compose
- Nginx (for production deployments)

### 1. Clone

```bash
git clone https://github.com/hroomnik007/MintRadar.git
cd MintRadar/MintRadar
```

The frontend and backend source live in the `MintRadar/` subdirectory. The working directory for app code, Docker, and CI is `MintRadar/MintRadar`. The repository root holds only README, LICENSE, SECURITY.md, CONTRIBUTING.md, and repository config (`.github/`, `.gitignore`, `.gitleaks.toml`).

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
DATABASE_URL=postgresql://mintradar:yourpassword@localhost:5432/mintradar
ALLOWED_ORIGINS=http://localhost:5173
```

### 3. Start the backend

```bash
docker compose up -d
```

This starts PostgreSQL and the backend API on port 3002.

### 4. Run the frontend

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Production build

```bash
npm run typecheck && npm run build
```

Serve the `dist/` directory with Nginx. See `MintRadar/deploy/nginx.conf` for the recommended Nginx configuration — includes CSP, HSTS, X-Frame-Options, and the `/api/` reverse proxy block.

---

## 🔐 Security

MintRadar handles Nostr private keys and is used by the Bitcoin/Cashu community where trust matters. To report a vulnerability, see **[SECURITY.md](../SECURITY.md)**.

- No tracking or telemetry
- Nostr private keys are never sent to the server or written to browser storage; an nsec is held in memory for the session and zeroed on logout
- No `dangerouslySetInnerHTML`; user-controlled URLs are validated before rendering
- Backend SSRF protection (DNS pinning + blocked IP ranges), rate limiting, parameterized SQL
- Docker non-root containers and internal-only port binding
- HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR. Look for issues labeled **good first issue**.

---

## 🔗 Links

- [MintRadar](https://mintradar.org)
- [Public API](docs/API.md)
- [Cashu Protocol](https://cashu.space)
- [Nostr Protocol](https://nostr.com)
- [NIP-87 — Mint Discovery](https://github.com/nostr-protocol/nips/blob/master/87.md)

---

## 📄 License

[MIT](LICENSE)

App code is MIT. Bundled webfonts are **SIL Open Font License 1.1** (DM Sans, JetBrains Mono) — both OSI-approved / libre licenses, self-hosted under `MintRadar/public/fonts/`.

---

**Built with ⚡ for the Cashu & Nostr community**
