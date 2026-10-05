#!/usr/bin/env node
// Fails (exit 1) when the SPA routes in src/App.tsx and the route list in deploy/nginx.conf differ.
//
// nginx answers 200 + index.html only for known routes and 404 (still with index.html as the body, so React
// Router renders the Not found page) for everything else, so a route that exists in the router but not in
// nginx would become a 404 on a hard load, and an nginx entry without a route would be a 200 for a page that
// does not exist. Run it after changing either file:  node scripts/check-route-consistency.mjs
//
//   --router <file>   default src/App.tsx
//   --nginx  <file>   default deploy/nginx.conf
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback
}
const routerFile = arg('--router', join(root, 'src/App.tsx'))
const nginxFile = arg('--nginx', join(root, 'deploy/nginx.conf'))
const errors = []

// ── Router: children of the root route in createBrowserRouter ──────────────────────────────
const routerSrc = readFileSync(routerFile, 'utf8')
const childrenStart = routerSrc.indexOf('children: [')
const childrenEnd = routerSrc.indexOf('\n    ],', childrenStart)
if (childrenStart === -1 || childrenEnd === -1) {
  console.error(`Cannot find the "children: [ ... ]" block in ${routerFile}`)
  process.exit(1)
}
const childrenSrc = routerSrc.slice(childrenStart, childrenEnd)
const routes = [] // path without leading slash; '' = index
for (const m of childrenSrc.matchAll(/\bindex:\s*true\b|\bpath:\s*'([^']*)'/g)) routes.push(m[1] ?? '')
if (routes.length === 0) {
  console.error('No routes found in the router')
  process.exit(1)
}
const catchAll = routes.includes('*')
const appRoutes = routes.filter(r => r !== '*')

// ── nginx: the ROUTES-marked regex location, /mint/ prefix location, and "/" fallback ────────
const nginxSrc = readFileSync(nginxFile, 'utf8')
const marker = nginxSrc.indexOf('# ROUTES:')
const locMatch = marker === -1 ? null : /location ~ (\^\/\(\?:(.*)\)\/\?\$) \{/.exec(nginxSrc.slice(marker))
if (!locMatch) {
  console.error('Cannot find the "# ROUTES:" marker followed by `location ~ ^/(?:...)/?$ {` in ' + nginxFile)
  process.exit(1)
}
const pattern = locMatch[1]
const body = locMatch[2]
const rx = new RegExp(pattern)

// Top-level alternatives of the group, expanded to concrete route shapes (':p' = one path segment).
function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === '|' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  return parts
}
const nginxRoutes = []
for (const alt of splitTopLevel(body)) {
  const withParam = /^([a-z0-9-]+)\(\?:\/\[\^\/\]\+\)\?$/.exec(alt)
  if (withParam) nginxRoutes.push(withParam[1], `${withParam[1]}/:p`)
  else if (/^[a-z0-9-]+$/.test(alt)) nginxRoutes.push(alt)
  else errors.push(`Unsupported nginx route alternative "${alt}" (teach this script, or keep to name and name(?:/[^/]+)?)`)
}

const hasMintPrefix = /^\s*location \/mint\/ \{/m.test(nginxSrc)
const rootBlock = /^\s*location \/ \{([^}]*)\}/m.exec(nginxSrc)
const rootOk = rootBlock !== null && /try_files \$uri \$uri\/ =404;/.test(rootBlock[1]) && /error_page 404 \/index\.html;/.test(rootBlock[1])
if (!rootOk) errors.push('`location / { ... }` must be `try_files $uri $uri/ =404;` plus `error_page 404 /index.html;`')

const segs = p => p.split('/').filter(Boolean)
const concrete = p => '/' + segs(p).map(s => (s.startsWith(':') ? 'sample' : s)).join('/')
const sameShape = (a, b) => {
  const x = segs(a), y = segs(b)
  return x.length === y.length && x.every((s, i) => s.startsWith(':') || y[i].startsWith(':') || s === y[i])
}

// A. every router route is known to nginx
for (const r of appRoutes) {
  if (r === '') continue // "/" is served by the directory index in `location /`
  if (r.startsWith('mint/')) {
    if (!hasMintPrefix) errors.push(`Router route /${r} needs \`location /mint/ {\` in nginx`)
    continue
  }
  const c = concrete(r)
  if (!rx.test(c) || !rx.test(c + '/')) errors.push(`Router route /${r} is missing from the nginx route list (${c} does not match)`)
}
if (!appRoutes.includes('')) errors.push('Router has no index route, but nginx serves / as the app')

// B. every nginx route exists in the router
for (const n of nginxRoutes) {
  if (!appRoutes.some(r => sameShape(r, n))) errors.push(`nginx lists /${n}, but the router has no such route`)
}
// nginx must not claim /mint/ routes in the regex (they belong to the prefix location)
if (nginxRoutes.some(n => n === 'mint' || n.startsWith('mint/'))) errors.push('nginx route regex must not list mint routes (location /mint/ handles them)')
if (!appRoutes.some(r => r.startsWith('mint/'))) errors.push('Router has no /mint/ routes, but nginx has `location /mint/`')

// C. unknown paths must not match
for (const p of ['/nope-missing', '/stats/extra', '/learn/a/b', '/dashboard', '/mint']) {
  if (rx.test(p)) errors.push(`nginx route regex matches ${p}, which must be a 404`)
}

const fmt = list => list.map(r => '/' + r).join('  ') || '(none)'
console.log('router routes   :', fmt(appRoutes.map(r => r || '').filter(r => r !== '')), ' + / (index)', catchAll ? ' + * (Not found)' : '')
console.log('nginx regex     :', fmt(nginxRoutes), ' + /mint/ prefix + / (index)')
if (!catchAll) errors.push('Router has no "*" catch-all route (the Not found page)')

if (errors.length > 0) {
  console.error('\nROUTE MISMATCH')
  for (const e of errors) console.error(' - ' + e)
  process.exit(1)
}
console.log('OK: router and nginx route lists match')
