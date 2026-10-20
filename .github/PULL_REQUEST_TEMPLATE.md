<!--
  Thanks for contributing to MintRadar!
  For anything larger than a small fix, please make sure there is an issue
  discussing this change before you open the PR.
  Do NOT use this template for security vulnerabilities — see SECURITY.md.
-->

## Summary

<!-- What does this PR do, and why? -->

## Related issue

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Refactor / internal-only change
- [ ] Documentation
- [ ] Dependency update

## How was this tested?

<!-- Commands run, manual steps, browsers/devices checked -->

## Checklist

CI runs the backend and frontend unit tests on every pull request and on every push to
`main`. Typecheck, lint and the e2e suite are not in CI; run them locally.

- [ ] `npm run typecheck` passes (local only, not in CI)
- [ ] `npm run lint` passes (local only, not in CI)
- [ ] `npm test` and `(cd backend && npm test)` pass (CI runs both)
- [ ] `npm run build` succeeds
- [ ] Tests added/updated for the change (required for security-relevant code)
- [ ] Docs updated (`README.md`, `.github/CONTRIBUTING.md`) if behavior or setup changed
- [ ] No new analytics, telemetry, third-party scripts, or external CDN/font requests
- [ ] Nostr private keys and watchlist data are still never sent to the backend
- [ ] Commit messages are short imperative sentences (see `.github/CONTRIBUTING.md`)
