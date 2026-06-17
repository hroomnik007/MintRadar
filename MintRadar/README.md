# MintRadar ⚡

> A modern, responsive web application for discovering and monitoring Cashu mints.

---

## 🌟 Overview

**MintRadar** monitors Cashu ecash mints in real-time. It automatically discovers mints via **Nostr NIP-87** and **audit.8333.space**, tracks their availability, latency, supported NUTs, and software version — all **without tracking users**.

**Live Demo:** [https://mintradar.pedani.eu](https://mintradar.pedani.eu)

---

## ✨ Features

### 🟢 Live Monitoring
- Tests all known mints every 5 minutes
- Real online/offline status with color indicators
- Latency measured server-side from Frankfurt, DE (displayed in neutral white — no color coding)
- "Show my latency" button for client-side latency test directly in the browser

### 📊 Uptime & History
- 24-hour uptime percentage with color indicators (green/yellow/red)
- Latency sparklines and historical charts powered by PostgreSQL data
- Automatically hides mints that have been offline for more than 24 hours
- Historical charts with interval selector (24h / 7d / 30d / 90d) for Latency, Uptime, and Trust Score
- Per-period averages with delta vs previous period

### 🔍 NUT Compatibility
- Overview of 14 tracked Cashu NUTs (NUT-04, NUT-05, NUT-07 to NUT-12, NUT-14, NUT-15, NUT-17, NUT-19, NUT-20, NUT-29)
- Click any NUT card to see description, supported features, and link to specification
- Min/max amount limits displayed for NUT-04 (Mint tokens) and NUT-05 (Melt tokens)
- Mint Backup Checker — NUT-13 support indicator (Backup supported / No backup)

### 🏆 Trust Score
- Composite trust score with interactive breakdown modal:
  - **Uptime 45%** — based on 24h availability
  - **NUT Support 30%** — number of supported NUT specifications
  - **Version freshness 15%** — recency of mint software vs. latest Nutshell releases
  - **Contact info 5%** — number of contact methods provided (email, Twitter, Nostr, website)
  - **Audit reliability 5%** — error rate from audit.8333.space
- Each breakdown row has a hover tooltip explaining the scoring

### 🛡 Audit Stats
- Integration with **audit.8333.space** — real third-party mint audits
- Displays mint ops, melt ops, and error counts per mint
- Audit reliability score feeds into Trust Score

### 👁 Watchlist
- Local favorite mint tracking (IndexedDB) — requires Nostr login
- Synced across devices as **NIP-44 encrypted kind:10003** events to Nostr relays when logged in
- Export as **JSON** or **CSV**
- Sort by Status, Latency, Name, or Trust Score with ascending/descending toggle

### 🔔 Nostr DM Notifications
- Notifications on mint downtime or recovery
- Sent directly from the browser (NIP-07) — server never sees your keys

### ⚡ Mint Discovery
- Automatic discovery via **Nostr kind 38172** (relays: damus.io, nos.lol, primal.net, cashumints.space, azzamo.net, snort.social, purplepag.es)
- Additional discovery via **audit.8333.space API**
- Manual mint submission by **URL** or **Nostr npub** (resolves the mint URL from the profile)
- Dashboard sort by Status, Latency, Name, or Trust Score with ascending/descending toggle
- Bulk mint submission — paste multiple URLs at once, probed and added sequentially

### ✍️ Reviews
- Decentralized mint reviews via Nostr (kind 38000)

### 🃏 Mint Cards
- Compact / Expanded view toggle — compact shows status and uptime, expanded adds latency and NUT count below the Watch button
- Mint Age badges — Fresh / Established / Veteran / OG based on time since discovery
- Trust Score color coding — Low Trust (red) / Moderate Trust (orange) / High Trust (green)
- Online cards — green gradient with accent left border; offline/unknown cards — red gradient with red left border
- Mint logo 32px, mint name 16px for improved readability

### 🔎 Search & Filter
- Advanced filter panel — filter by Status, Trust Score minimum, Mint Age, and NUT support
- Filters applied on demand; active filters shown as tags
- Filter panel, comparison bar, and mint count text fully in English

### ⚖️ Mint Comparison
- Select 2–4 mints and compare side-by-side in a modal
- Compares: Status, Trust Score, Uptime, Latency, NUT count, NUT support grid, Version, Backup support
- Row-aligned CSS Grid layout — all values in the same row always align horizontally
- NUT support chips show all 14 tracked NUTs with green/gray color coding per mint

### 📈 Global Stats
- Network-wide statistics page (/stats)
- Total / Online / Offline mint counts, Average Trust Score and Latency
- Trust Score distribution donut chart — compact layout with legend side by side
- Top 5 mints by Trust Score
- **NUT Explorer** — 14 NUT cards (NUT-04, 05, 07–12, 14, 15, 17, 19, 20, 29) each showing adoption %, supporting mint count, spec link, and "+N more" button
- "+N more" modal — searchable, scrollable list of all mints supporting that NUT with online/offline indicator

---

## 🔒 Privacy First

| Feature          | How it works                                                                          |
|------------------|---------------------------------------------------------------------------------------|
| Watchlist        | Stored in browser (IndexedDB) + optionally synced as NIP-44 encrypted kind:10003     |
| Nostr keys       | NIP-07 extension — server never sees them                                             |
| Analytics        | None                                                                                  |
| Cookies          | None                                                                                  |
| Fonts            | Self-hosted (DM Sans)                                                                 |

---

## 🛠 Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **State:** TanStack Query + Zustand + Dexie
- **Charts:** Recharts
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL
- **Nostr:** nostr-tools
- **Deployment:** Docker + Nginx + GitHub Actions CI/CD

---

## 📥 Browser Extension Support

To write reviews you need a Nostr browser extension:

- **[Alby](https://getalby.com/alby-extension)** — recommended (Lightning + Nostr)
- **[nos2x](https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp)** — Chrome / Edge
- **[nos2x-fox](https://addons.mozilla.org/en-US/firefox/addon/nos2x-fox/)** — Firefox

---

## 🔗 Useful Links

- [Live Demo](https://mintradar.pedani.eu)
- [Cashu Protocol](https://cashu.space)
- [Nostr Protocol](https://nostr.com)
- [NIP-87 — Mint Discovery](https://github.com/nostr-protocol/nips/blob/master/87.md)

---

**Built with ⚡ for the Cashu & Nostr community**
