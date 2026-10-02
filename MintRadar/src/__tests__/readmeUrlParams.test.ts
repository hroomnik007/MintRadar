// Guards the README's URL-parameters passage: every `?name=` query parameter it names
// must still appear as a quoted string in the app source, so a renamed or removed
// parameter can't stay documented. Only the Dashboard & Discovery section is read.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

const source = sourceFiles(path.join(ROOT, 'src')).map(f => fs.readFileSync(f, 'utf8')).join('\n')

function documentedParams(readme: string): string[] {
  const start = readme.search(/^#+ .*Dashboard & Discovery/m)
  const rest = start < 0 ? '' : readme.slice(readme.indexOf('\n', start) + 1)
  const end = rest.search(/^#{1,3} /m)
  const section = end < 0 ? rest : rest.slice(0, end)
  return [...new Set([...section.matchAll(/\?([a-z]+)=/g)].map(m => m[1] as string))]
}

describe('README URL parameters', () => {
  for (const file of ['README.md', '../README.md']) {
    it(`${file}: every documented ?param= is still read by the source`, () => {
      const params = documentedParams(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      expect(params.length, 'no ?param= found in the Dashboard & Discovery section').toBeGreaterThan(0)
      for (const p of params) {
        expect(source, `?${p}= is in ${file} but no '${p}' string exists in src/`).toMatch(new RegExp(`['"\`]${p}['"\`]`))
      }
    })
  }
})
