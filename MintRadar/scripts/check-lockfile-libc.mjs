#!/usr/bin/env node
// Fails (exit 1) when a lockfile lost the "libc" field of a Linux platform package.
//
// npm 10 drops "libc" when it rewrites a lockfile; without it `npm ci` on Linux installs the musl variants too
// (node_modules grew by 36 MB once). The lockfiles are repaired and kept with npm 11. This check reads the lockfiles
// (default: package-lock.json and backend/package-lock.json) and fails for every package whose name says
// "<something>-linux-<cpu>-gnu" or "-musl" and has no "libc" array.
//
// Packages that never publish a libc field upstream are listed in NO_LIBC_UPSTREAM (verified against the committed
// lockfiles: @rollup/rollup-linux-x64-gnu, lightningcss-linux-x64-gnu, @napi-rs/lzma-linux-x64-gnu have none even
// with npm 11). A package of that kind that appears later is listed there on purpose, never by silencing the check.
// The "-gnueabihf" / "-musleabihf" ARM variants do not end in -gnu / -musl and are not covered.
//
//   node scripts/check-lockfile-libc.mjs [lockfile ...]
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const NO_LIBC_UPSTREAM = ['@rollup/rollup-', 'lightningcss-', '@napi-rs/lzma-']

const LINUX_LIBC_NAME = /-linux-[^/]*-(?:gnu|musl)$/

/** The package name of a lockfile "packages" key ("node_modules/a/node_modules/@s/b" -> "@s/b"). */
export function packageName(path) {
  const i = path.lastIndexOf('node_modules/')
  return i === -1 ? path : path.slice(i + 'node_modules/'.length)
}

/** @returns {{ checked: number, missing: string[] }} entries that need a libc field, and those that lack it. */
export function checkLockfile(lock, exempt = NO_LIBC_UPSTREAM) {
  let checked = 0
  const missing = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '') continue
    const name = packageName(path)
    if (!LINUX_LIBC_NAME.test(name) || exempt.some(p => name.startsWith(p))) continue
    checked++
    if (!Array.isArray(entry.libc) || entry.libc.length === 0) missing.push(path)
  }
  return { checked, missing }
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const files = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map(f => resolve(f))
    : [join(root, 'package-lock.json'), join(root, 'backend/package-lock.json')]
  let failed = false
  for (const file of files) {
    const { checked, missing } = checkLockfile(JSON.parse(readFileSync(file, 'utf8')))
    if (missing.length > 0) {
      failed = true
      console.error(`FAIL ${file}: ${missing.length} of ${checked} Linux platform packages have no "libc" field:`)
      for (const m of missing) console.error(`  ${m}`)
      console.error('The lockfile was rewritten by npm 10. Regenerate it with npm 11 (npx --yes npm@11 install --package-lock-only) and run this check again.')
    } else {
      console.log(`OK: ${file}: ${checked} Linux platform packages checked, all have "libc"`)
    }
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
