# MintRadar

Open-source Cashu mint monitoring dashboard. Live at https://mintradar.pedani.eu

## Features
- Real-time mint monitoring (probing every 5 min)
- Trust Score system with breakdown modal (Uptime 45%, NUT support 30%, Version 15%, Contact 5%, Audit 5%)
- Dashboard with compact/expanded card view, search, filters (Status, Trust Score, Mint Age, NUT support)
- Mint Detail with Overview, History, NUTs, Audit, Reviews tabs
- Historical charts — Latency, Uptime, Trust Score (24h/7d/30d/90d)
- Global Stats page — NUT adoption, Trust Score distribution, Top 5, Software distribution, Geographic distribution
- NUT Explorer — protocol adoption across all online mints with +N more modal
- Mint Comparison Tool (side-by-side comparison)
- Watchlist with Nostr login and DM alerts
- Nostr NIP-87 mint discovery
- Version history tracking
- Mint Age badges (Fresh/Established/Veteran/OG)
- NUT Limits display (NUT-04/NUT-05)
- Backup checker (NUT-13)
- Bulk mint submission
- PostgreSQL automatic backups (every 6h)

## Tech stack
- Frontend: React 19 / TypeScript / Vite / TanStack Query v5 / Zustand / Recharts / Tabler Icons / vite-plugin-pwa
- Backend: Node.js / Express / PostgreSQL / Docker
- Deploy: GitHub Actions CI/CD → Hetzner VPS / Nginx

## Self-hosting
```bash
git clone https://github.com/hroomnik007/MintRadar
cd MintRadar
cp backend/.env.example backend/.env  # fill in POSTGRES_PASSWORD
docker compose up -d
```
Frontend: npm install && npm run build

## License
See LICENSE file.
