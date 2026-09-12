# Security Policy

## Reporting a Vulnerability

**Preferred:** Nostr DM to the project maintainer — npub is listed on [mintradar.org](https://mintradar.org).

**Alternative:** [GitHub private vulnerability reporting](https://github.com/hroomnik007/MintRadar/security/advisories/new)

Please include in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Affected component (frontend, backend, Docker config, etc.)

Expected response time: best effort, typically within 7 days.

---

## Scope

### In scope

- Frontend private key handling (nsec zeroing, NIP-07 delegation, NIP-46 bunker session)
- Backend API endpoints — SSRF, SQL injection, auth bypass, rate limit bypass
- NIP-44 watchlist encryption implementation
- Docker and Nginx configuration (container isolation, header policies)
- Dependency vulnerabilities with direct exploitability against MintRadar users

### Out of scope

- External Nostr relays (damus.io, nos.lol, etc.)
- audit.8333.space third-party service
- The Cashu protocol itself
- Individual mint operators' infrastructure

---

## Threat Model

| Risk | Mitigation |
|------|-----------|
| nsec in browser memory | Key is used only to derive the public key, then explicitly zeroed (`privkeyBytes.fill(0)`); never stored in localStorage, sessionStorage, or sent to the server |
| NIP-44 encrypted watchlist | Encrypted with the user's own Nostr key; server never sees plaintext; decryption happens entirely in the browser |
| Backend SSRF | Outbound probe URLs go through `checkUrlSafety()` / `safeFetch()` (`backend/src/ssrf.ts`): HTTPS only, private/loopback/link-local/CGNAT/IPv4-in-IPv6 blocked, DNS re-checked at connect time, redirects re-validated |
| XSS | No `dangerouslySetInnerHTML`; user-controlled URLs validated before rendering; CSP via Nginx |
| Rate limits | 60 req/min/IP on reads; tighter hourly caps on `/api/mint/submit` and `/api/mints/discover` |
| Backend bind | Docker publishes the API as `127.0.0.1:3002` only — not on the public interface. Nginx on the host reverse-proxies `/api/` |

---

## Known Limitations (by design, not bugs)

- The server sees every mint URL submitted for monitoring — this is necessary for server-side probing
- All probes originate from a single Frankfurt IP — mints can detect and block this IP
- nsec login leaves the derived public key in JS memory for the duration of the session; the raw private key bytes are zeroed immediately after derivation
- Watchlist sync uses NIP-44 single-key encryption — no multi-sig or threshold encryption
- Trust Score is a health/transparency signal, not a measure of solvency

---

## Automated Security Testing

GitHub Actions `deploy` runs the full frontend and backend test suites before deploy (`needs: test`). Dedicated security tests live in `backend/src/__tests__/security/` (CORS, headers, input validation, rate limiting, error leakage) plus `ssrfGuard.test.ts`.

Exact test counts change as the suite grows — CI on `main` is the source of truth, not a number frozen in this file.

### Coverage

| Area | What is tested |
|------|---------------|
| SSRF protection | `isSafeUrl()` / `safeFetch()` block private IPv4/IPv6 ranges, loopback, link-local, CGNAT, and DNS-rebinding-style resolutions |
| SQL injection | DB access uses parameterized `pg` queries |
| Rate limiting | Per-IP limits on `/api/mint/submit` and `/api/mints/discover` return 429 on excess |
| CORS allow-list | Only allowed origins receive `Access-Control-Allow-Origin` |
| HTTP security headers | HSTS, X-Content-Type-Options, X-Frame-Options, CSP presence |
| Input validation | Oversized URLs, null bytes, and unexpected fields are rejected |
| Error message leakage | 4xx/5xx responses must not expose stack traces, internal paths, or DB schema |

Last documentation review: **2026-09-12**.
