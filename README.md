# MintRadar ⚡

> Privacy-first monitoring for Cashu ecash mints — real-time status, trust scoring, and decentralized discovery via Nostr.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Self-Hostable](https://img.shields.io/badge/self--hostable-yes-green.svg)](#-getting-started--self-hosting)
[![Open Source](https://img.shields.io/badge/open%20source-%E2%9D%A4-red.svg)](https://github.com/hroomnik007/MintRadar)

**Live:** [mintradar.org](https://mintradar.org)

---

## ✨ Features

### 📊 Real-Time Monitoring

- Probes all known mints every **5 minutes** via `/v1/info`
- A mint is ONLINE only if the endpoint returns HTTP 200 with valid JSON containing a `nuts` field
- Server-side latency measured from Frankfurt, DE
- "Show my latency" button for a client-side test directly from your browser

### 🛡️ Trust Score System

Composite score (0–100) calculated server-side after every probe. Shown alongside a separate **Community Rating** (average of Nostr reviews), so an operator-independent signal sits next to the objective one:

| Component | Weight | Basis |
|-----------|--------|-------|
| Uptime | 40% | 24 h availability |
| NUT Support | 15% | Supported NUT specs (out of the tracked mint-side set) |
| Version Freshness | 15% | Recency of the mint's software release (Nutshell or cdk) vs. latest known version |
| Contact Info | 5% | Contact methods provided (email, Twitter, Nostr, website) |
| Audit Reliability | 25% | Rolling-window error rate (last ~100 real swaps) from audit.8333.space; new mints (<30 days) are capped at 75 |

Interactive breakdown modal on each mint — hover any row for a tooltip explaining the scoring logic.

### 🔍 Dashboard & Discovery

- Search by name or URL
- Advanced filter panel: Status, Trust Score minimum, NUT support
- Active filters shown as dismissible tags
- Sort by Latency / Name / Trust Score / **Community Rating** / **Most reviewed** (asc/desc) — Community Rating uses a weighted (Bayesian) average so a mint with two 5★ reviews doesn't outrank one with fifty
- Controls row stays docked at the top of the list while you scroll
- Compact and expanded card view toggle
- Single URL or bulk mint submission (paste multiple URLs at once)
- Recently discovered mints get a **New** badge (first 30 days); known dev/test mints are badged separately and kept out of recommendations

### 📈 Historical Data

- Charts for **Latency**, **Uptime**, and **Trust Score** over 24 h / 7 d / 30 d / 90 d
- Per-period averages with delta vs. previous period
- Full Mint History panel with per-probe results
- **Audit tab** on each mint — a summary strip (mints / melts / recent errors / honest "Last checked" time) backed by real swap data from audit.8333.space, with an amber/red reliability signal based on the rolling error rate

### 🌐 Global Stats

- Network-wide totals: online/offline counts, average trust score, average latency
- Trust Score distribution
- Top mints by Trust Score
- NUT adoption across the network
- Software in use across known mints
- Trust movers — recent risers and fallers

### 🧩 NUT Explorer

Tracked mint-side NUT cards (NUT-04, 05, 07–30; NUT-13 is a wallet-side spec and is not advertised by mints) — each showing adoption %, supporting mint count, and a link to the specification. Expandable list of supporting mints.

### ⚖️ Mint Comparison Tool

Select 2–4 mints and compare side-by-side: Status, Trust Score, Community Rating, Uptime, Latency, NUT support grid, software version. On narrow screens the table becomes a stacked/tabbed layout — one mint at a time, no horizontal scrolling.

### 👁️ Watchlist with Nostr Login

- Login via **NIP-07 browser extension**, **nsec private key**, or **NIP-46 bunker / Amber**
- Adding a mint to your watchlist requires a Nostr login (you're prompted to sign in first) — this keeps the list portable across devices
- Watchlist stored locally in IndexedDB — never sent to the server
- Optionally synced across devices as **NIP-44 encrypted kind:10003** events on Nostr relays
- Export as **JSON** or **CSV**
- DM notifications on mint downtime/recovery, sent directly from your browser via NIP-07

### 📡 Nostr NIP-87 Discovery

Automatic mint discovery on a schedule from a set of public Nostr relays, using **kind:38172** mint announcements and **kind:38000** review events (URL mining), plus the **audit.8333.space** API — sources running in parallel.

### 🔧 Tools

- **Token Inspector** — paste a Cashu token (`cashuA` / `cashuB`) to see its mint, amount, unit, proof count, memo, mint status, and Trust Score, plus a risk badge for the issuing mint — with a link to Mint Detail or Cashu.me. Optional **Check if spent** queries the mint (NUT-07) for unspent / spent / partial proofs
- **Best Mint for Me** — short wizard (unit, what matters most, whether you need seed-phrase restore). Latency is measured live from your browser; the top matches show latency, uptime, Trust Score, LN support, and mint/melt limits for the chosen unit

### 📚 Learn

A 5-module "Cashu 101" course, written as plain-language text with custom illustrated diagrams and highlighted key-takeaway callouts — no quizzes or progress tracking, just prev/next navigation between modules:

1. **Cashu Basics** — what Cashu actually is: the mint holds your Bitcoin, you hold a bearer token, and blind signatures keep person-to-person transfers private
2. **Understanding the Risks** — why a mint can disappear or refuse to pay, why nobody can currently verify a mint has real backing, and how to limit what you stand to lose
3. **How to Choose a Mint** — what to check before trusting a mint (uptime, NUT support, operator transparency) and how MintRadar's Trust Score combines those signals
4. **Getting Started with a Wallet** — choosing a wallet, adding your first mint, making a deposit, sending tokens, and why backing up your seed phrase is non-negotiable
5. **Safe Habits** — day-to-day habits (diversifying mints, redeeming regularly, checking Trust Score first) that meaningfully reduce your risk

### 👛 Wallet Directory

A hand-maintained list of Cashu-compatible wallets — each with supported platforms, a short description, and a link to the wallet's own site. No ranking, reviews, or affiliate links.

### ⭐ Nostr-Based Reviews

Mint Detail page shows community reviews as **kind:38000** events. On page load they're fetched live from a small fast relay set; a server-side sync additionally aggregates reviews from a broader relay set so counts and averages stay complete. Ratings are parsed from review text (`[N/5]` format). Author profiles (name + avatar) are resolved from Nostr. Images are only loaded over HTTPS.

- Filter chips: **All**, **5★**, **Critical** (≤ 2★), and a separate **Hide anon** toggle
- A short disclaimer notes these are unverified NIP-87 events from the open Nostr network, not vetted testimonials
- Write your own review from the page, with a "Signing with …" indicator for the active login method

### 🔗 Social Link Previews

Sharing a mint page link on Twitter/X, Discord, Telegram, Slack, or WhatsApp shows a preview card with that mint's name, Trust Score, and online status — server-rendered for link-preview crawlers that don't run JavaScript.

### 🔒 Privacy-First

- **No analytics, no tracking, no telemetry, no third-party scripts**
- **No cookies**
- Fonts are self-hosted — no requests to Google Fonts or any external font CDN
- Nostr private keys **never leave your browser** and are never stored or transmitted to the backend
- Watchlist data lives only in your browser (IndexedDB) or encrypted on Nostr relays under your own key

### 🔁 Automatic Backups

PostgreSQL database backed up every 6 hours via server cron.

### 📎 Public API

Read-only JSON under `https://mintradar.org/api/` (for example `GET /api/mints/known`). Unofficial, rate-limited, may change. See [MintRadar/docs/API.md](MintRadar/docs/API.md).

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
- **nsec** — paste your private key; it's used only to derive the public key and then immediately zeroed in memory, never stored
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

The frontend and backend source live in the `MintRadar/` subdirectory.

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

MintRadar handles Nostr private keys and is used by the Bitcoin/Cashu community where trust matters. To report a vulnerability, see **[SECURITY.md](SECURITY.md)**.

- No tracking or telemetry
- Nostr private keys never stored or sent to the server; raw nsec bytes are zeroed in memory after use
- No `dangerouslySetInnerHTML`; user-controlled URLs are validated before rendering
- Backend SSRF protection (DNS pinning + blocked IP ranges), rate limiting, parameterized SQL
- Docker non-root containers and internal-only port binding
- HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR.

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

App code is MIT. Bundled webfonts are **SIL Open Font License 1.1** (DM Sans, JetBrains Mono) — both OSI-approved / libre licenses, self-hosted under `MintRadar/public/fonts/`.

---

**Built with ⚡ for the Cashu & Nostr community**
