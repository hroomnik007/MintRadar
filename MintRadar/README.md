# MintRadar ⚡

> Privacy-first monitoring for Cashu ecash mints — real-time status, trust scoring, and decentralized discovery via Nostr.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Self-Hostable](https://img.shields.io/badge/self--hostable-yes-green.svg)](#-getting-started--self-hosting)
[![Open Source](https://img.shields.io/badge/open%20source-%E2%9D%A4-red.svg)](https://github.com/hroomnik007/MintRadar)

**Live Demo:** [mintradar.pedani.eu](https://mintradar.pedani.eu)

---

## ✨ Features

### 📊 Real-Time Monitoring

- Probes all known mints every **5 minutes** via `/v1/info`
- A mint is ONLINE only if the endpoint returns HTTP 200 with valid JSON containing a `nuts` field
- Server-side latency measured from Frankfurt, DE
- "Show my latency" button for a client-side test directly from your browser

### 🛡️ Trust Score System

Composite score (0–100) calculated server-side after every probe:

| Component | Weight | Basis |
|-----------|--------|-------|
| Uptime | 45% | 24 h availability |
| NUT Support | 30% | Supported NUT specs (out of 14 tracked) |
| Version Freshness | 15% | Recency of Nutshell release vs. latest known version |
| Contact Info | 5% | Contact methods provided (email, Twitter, Nostr, website) |
| Audit Reliability | 5% | Error rate from audit.8333.space third-party audits |

Interactive breakdown modal on each mint — hover any row for a tooltip explaining the scoring logic.

### 🔍 Dashboard & Discovery

- Search by name or URL
- Advanced filter panel: Status, Trust Score minimum, Mint Age, NUT support
- Active filters shown as dismissible tags
- Sort by Status / Latency / Name / Trust Score (asc/desc)
- Compact and expanded card view toggle
- Single URL or bulk mint submission (paste multiple URLs at once)

### 📈 Historical Data

- Charts for **Latency**, **Uptime**, and **Trust Score** over 24 h / 7 d / 30 d / 90 d
- Per-period averages with delta vs. previous period
- Full Mint History panel with per-probe results

### 🌐 Global Stats

- Network-wide totals: online/offline counts, average trust score, average latency
- Trust Score distribution donut chart
- Top 5 mints by Trust Score
- NUT adoption rates across the full network

### 🧩 NUT Explorer

14 tracked NUT cards (NUT-04, 05, 07–12, 14, 15, 17, 19, 20, 29) — each showing adoption %, supporting mint count, and a link to the specification. Expandable "+N more" modal with a searchable list of all supporting mints.

### ⚖️ Mint Comparison Tool

Select 2–4 mints and compare side-by-side: Status, Trust Score, Uptime, Latency, NUT support grid, Software version, Backup support (NUT-13).

### 👁️ Watchlist with Nostr Login

- Login via **NIP-07 browser extension** (Alby, nos2x, nos2x-fox) or **nsec private key**
- Watchlist stored locally in IndexedDB — never sent to the server
- Optionally synced across devices as **NIP-44 encrypted kind:10003** events on Nostr relays
- Export as **JSON** or **CSV**
- Sort by Status, Latency, Name, or Trust Score
- DM notifications on mint downtime/recovery, sent directly from your browser via NIP-07

### 📡 Nostr NIP-87 Discovery

Automatic mint discovery from 7 Nostr relays (damus.io, nos.lol, primal.net, cashumints.space, azzamo.net, snort.social, purplepag.es) using **kind:38172** events, plus the **audit.8333.space** API. Decentralized mint reviews via **kind:38000**.

### 🏷️ Mint Age Badges

| Badge | Age |
|-------|-----|
| 🌱 Fresh | < 7 days |
| ✅ Established | 7 – 90 days |
| 🏛️ Veteran | 90 days – 1 year |
| 👑 OG | > 1 year |

### 🔒 Privacy-First

- **No analytics, no tracking, no telemetry, no third-party scripts**
- **No cookies**
- Fonts are self-hosted (DM Sans) — no requests to Google Fonts or any external font CDN
- Nostr private keys **never leave your browser** and are never stored or transmitted to the backend
- Watchlist data lives only in your browser (IndexedDB) or encrypted on Nostr relays under your own key
- Full security and privacy audit documented in [AUDIT.md](AUDIT.md)

### 🔁 Automatic Backups

PostgreSQL database backed up every 6 hours via server cron.

---

## 🛠️ Tech Stack

**Frontend**
- React 18 + TypeScript + Vite 5
- TanStack Query v5, Zustand, Dexie (IndexedDB)
- Recharts, vite-plugin-pwa (PWA / offline support)
- nostr-tools, @noble/secp256k1

**Backend**
- Node.js 20 + Express + TypeScript
- PostgreSQL (via `pg`)
- nostr-tools for relay communication

**Deployment**
- Docker + Docker Compose (backend + PostgreSQL)
- Nginx (static frontend + `/api/*` reverse proxy)
- GitHub Actions CI

---

## 🚀 Getting Started / Self-Hosting

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Nginx (for production deployments)

### 1. Clone

```bash
git clone https://github.com/hroomnik007/MintRadar.git
cd MintRadar
```

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

Serve the `dist/` directory with Nginx. See `deploy/nginx.conf` for the recommended Nginx configuration — includes CSP, HSTS, X-Frame-Options, and the `/api/` reverse proxy block.

---

## 🔐 Security

MintRadar handles Nostr private keys and is used by the Bitcoin/Cashu community where trust matters. A full security and privacy audit is documented in **[AUDIT.md](AUDIT.md)**, covering:

- No tracking or telemetry (verified by code review)
- Nostr private key handling — keys never stored or sent to the server; raw key bytes explicitly zeroed in memory after use
- Dependency vulnerability scan and fixes
- XSS/injection prevention — no `dangerouslySetInnerHTML`, all user-controlled URLs validated before rendering
- Backend SSRF protection (DNS pinning + blocked IP ranges), rate limiting, and parameterized SQL queries
- Docker non-root containers and internal-only port binding
- HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a PR.

---

## 🔗 Links

- [Live Demo](https://mintradar.pedani.eu)
- [Cashu Protocol](https://cashu.space)
- [Nostr Protocol](https://nostr.com)
- [NIP-87 — Mint Discovery](https://github.com/nostr-protocol/nips/blob/master/87.md)

---

## 📄 License

[MIT](LICENSE)

---

**Built with ⚡ for the Cashu & Nostr community**
