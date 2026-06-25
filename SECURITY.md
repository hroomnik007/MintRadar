# Security Policy

## Reporting a Vulnerability

**Preferred:** Nostr DM to the project maintainer — npub is listed on [mintradar.pedani.eu](https://mintradar.pedani.eu).

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
| Backend SSRF | All outbound probe URLs validated by `isSafeUrl()` (ipaddr.js + DNS resolution); private IP ranges, loopback, link-local, and CGNAT ranges are blocked |
| XSS | No `dangerouslySetInnerHTML`; all user-controlled URLs validated before rendering; CSP header enforced via Nginx |
| Dependency supply chain | Regular `npm audit`; full dependency scan documented in AUDIT.md |

---

## Known Limitations (by design, not bugs)

- The server sees every mint URL submitted for monitoring — this is necessary for server-side probing
- All probes originate from a single Frankfurt IP — mints can detect and block this IP
- nsec login leaves the derived public key in JS memory for the duration of the session; the raw private key bytes are zeroed immediately after derivation
- Watchlist sync uses NIP-44 single-key encryption — no multi-sig or threshold encryption

---

See [AUDIT.md](MintRadar/AUDIT.md) for the full security and privacy audit.
