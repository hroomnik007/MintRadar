# Archive of scoring-and-probing.md
> History only: sections moved out of `docs/claude/scoring-and-probing.md` because they describe superseded or removed behaviour. Do not read this for current rules.

### NUT tracking expansion (2026-07-02) — superseded by the cut above

- Tracking 26 NUTs now (was 14) — added: 13, 16, 18, 21, 22, 23, 24, 25, 26, 27, 28, 30
- Mandatory NUTs (00-03, 06) are deliberately never tracked — implicitly 100% supported, zero information value
- Reliability Score NUT divisor changed from /14 to /26 in `prober.ts` — existing mints get a lower/more accurate score at their next probe cycle
  - **Correction (2026-08-19):** the divisor that actually shipped is **/25**, not /26, and NUT-13 is not tracked — it is a wallet-side spec a mint never advertises, so the list above ("added: 13, 16, …") overcounts by one. The live list is `TRACKED_NUTS` in `src/constants/nuts.ts` (25 entries); the divisor is `TRACKED_NUT_COUNT` in `backend/src/shared/reliabilityScore.ts`.
  - **Superseded 2026-09-14:** the divisor is back down to /14 — see "NUT tracking scope: mint-side vs. wallet-only" above.
- NUT-24 (HTTP 402) has 0% adoption across the ecosystem — expected, no implementation exists yet anywhere, and it's no longer tracked at all as of 2026-09-14 (wallet-only)
