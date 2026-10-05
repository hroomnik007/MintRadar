#!/usr/bin/env node
// Fails (exit 1) when a literal internal navigation target in src/ matches no route of the router.
//
// Extracts the targets of <Link to>, <NavLink to>, <Navigate to>, navigate('...'), href="/...",
// window.location assignments and `${window.location.origin}/...` share links, strips the query and hash
// and matches the path against the route patterns in src/App.tsx (/mint/<anything>, /learn/<slug>, ...).
// A path that only the "*" catch-all would answer is a broken link (it renders the Not found page).
// Targets built from variables are listed as "dynamic, not checked"; a target with a literal prefix and
// a `${...}` segment (e.g. /mint/${encodeURIComponent(url)}) has its literal part checked against the routes
// with the interpolated segment treated as "any one segment".
//
// Run it after adding or changing a link or a route:  node scripts/check-internal-links.mjs
//
//   --router <file>   default src/App.tsx
//   --src    <dir>    default src
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback
}
const routerFile = arg('--router', join(root, 'src/App.tsx'))
const srcDir = arg('--src', join(root, 'src'))

// ── Router routes (children of the root route; same extraction as check-route-consistency.mjs) ──
const routerSrc = readFileSync(routerFile, 'utf8')
const childrenStart = routerSrc.indexOf('children: [')
const childrenEnd = routerSrc.indexOf('\n    ],', childrenStart)
if (childrenStart === -1 || childrenEnd === -1) {
  console.error(`Cannot find the "children: [ ... ]" block in ${routerFile}`)
  process.exit(1)
}
const routes = []
for (const m of routerSrc.slice(childrenStart, childrenEnd).matchAll(/\bindex:\s*true\b|\bpath:\s*'([^']*)'/g)) routes.push(m[1] ?? '')
const appRoutes = routes.filter(r => r !== '*')
if (appRoutes.length === 0) {
  console.error('No routes found in the router')
  process.exit(1)
}
const routeSegs = appRoutes.map(r => r.split('/').filter(Boolean))

// A target segment containing ${...} stands for "some one segment" and matches any route segment.
const DYN = '\u0000'
const matchesRoute = targetSegs =>
  routeSegs.some(rs => rs.length === targetSegs.length && rs.every((s, i) => s.startsWith(':') || targetSegs[i].includes(DYN) || s === targetSegs[i]))

// ── Source files (tests are not app navigation) ──────────────────────────────────────────────
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__') yield* walk(p) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) yield p
  }
}

// One regex per context; group 1 = quote, group 2 = target starting with "/".
// `to=` also matches `to={'/x'}` and `to={`/x/${id}`}`; `to:` matches object entries.
const q = String.raw`(["'\`])(\/(?:(?!\1)[^\\\n])*)\1`
const CONTEXTS = [
  new RegExp(String.raw`\bto\s*=\s*\{?\s*` + q, 'g'),
  new RegExp(String.raw`\bto\s*:\s*` + q, 'g'),
  new RegExp(String.raw`\bnavigate\(\s*` + q, 'g'),
  new RegExp(String.raw`\bhref\s*=\s*\{?\s*` + q, 'g'),
  new RegExp(String.raw`\blocation\.(?:href|pathname)\s*=\s*` + q, 'g'),
  new RegExp(String.raw`\blocation\.(?:assign|replace)\(\s*` + q, 'g'),
]
// Share links built from the origin: `${window.location.origin}/mint/nostr/${naddr}`
const ORIGIN = /\$\{window\.location\.origin\}(\/[^`"'\n]*)/g
// Non-literal first argument of navigate(): navigate(-1) is history, anything else is a variable.
const NAVIGATE_ARG = /\bnavigate\(\s*([^"'`\s)-][^,)]*)/g
// (`to={{ hash: '#x' }}` has no pathname: it stays on the current route, so it is not matched here.)
const TO_VAR = /\bto\s*=\s*\{\s*([^"'`\s{}][^}]*)\}/g

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
const checked = [] // { file, line, raw }
const dynamic = []
const broken = []

for (const file of walk(srcDir)) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(root, file)
  const targets = []
  for (const rx of CONTEXTS) for (const m of src.matchAll(rx)) targets.push({ idx: m.index, raw: m[2] })
  for (const m of src.matchAll(ORIGIN)) targets.push({ idx: m.index, raw: m[1] })
  for (const m of src.matchAll(NAVIGATE_ARG)) dynamic.push({ file: rel, line: lineOf(src, m.index), raw: `navigate(${m[1].trim()})` })
  for (const m of src.matchAll(TO_VAR)) dynamic.push({ file: rel, line: lineOf(src, m.index), raw: `to={${m[1].trim()}}` })

  for (const t of targets) {
    const line = lineOf(src, t.idx)
    const noQuery = t.raw.split(/[?#]/)[0]
    const withDyn = noQuery.replace(/\$\{[^}]*\}/g, DYN)
    // static assets and API paths are not router targets
    if (/^\/(api|\.well-known)\//.test(withDyn) || /\.[a-z0-9]{2,5}$/i.test(withDyn)) continue
    const segs = withDyn.split('/').filter(Boolean)
    const hasDyn = withDyn.includes(DYN)
    if (hasDyn) dynamic.push({ file: rel, line, raw: t.raw + '   (literal part checked)' })
    else checked.push({ file: rel, line, raw: t.raw })
    if (!matchesRoute(segs)) broken.push({ file: rel, line, raw: t.raw })
  }
}

const out = list => list.map(t => `  ${t.file}:${t.line}  ${t.raw}`).join('\n')
console.log(`router routes     : ${appRoutes.map(r => '/' + r).join('  ')}`)
console.log(`literal targets   : ${checked.length} checked`)
if (dynamic.length > 0) console.log(`dynamic, not checked (${dynamic.length}):\n${out(dynamic)}`)

if (broken.length > 0) {
  console.error('\nBROKEN INTERNAL LINKS (no route matches)')
  console.error(out(broken))
  process.exit(1)
}
console.log('OK: every literal internal link matches a router route')
