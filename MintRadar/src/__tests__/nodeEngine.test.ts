import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Node 22 is the version the project runs on (the backend Docker image, the deploy workflow). Node 20 fails the unit suites
// with "webidl.util.markAsUncloneable is not a function". The declaration is a warning only (no engine-strict anywhere),
// and this test keeps the four places that name a Node major in step.

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const major = (range: string) => /(\d+)/.exec(range)?.[1]

describe('Node major version', () => {
  const frontend = JSON.parse(read('package.json')) as { engines?: { node?: string } }
  const backend = JSON.parse(read('backend/package.json')) as { engines?: { node?: string } }

  it('both package.json files require Node >=22', () => {
    expect(frontend.engines?.node).toBe('>=22')
    expect(backend.engines?.node).toBe('>=22')
  })

  it('the backend Dockerfile, .nvmrc and both engines name the same major', () => {
    const docker = /^FROM node:(\d+)/m.exec(read('backend/Dockerfile'))?.[1]
    const nvmrc = /^(\d+)\s*$/.exec(read('.nvmrc'))?.[1]
    const majors = [major(frontend.engines?.node ?? ''), major(backend.engines?.node ?? ''), docker, nvmrc]
    expect(majors).toEqual(['22', '22', '22', '22'])
  })

  it('the engines field stays a warning (no engine-strict)', () => {
    for (const f of ['package.json', 'backend/package.json']) expect(read(f)).not.toMatch(/engine-strict/)
    for (const f of ['.npmrc', 'backend/.npmrc']) {
      let text = ''
      try { text = read(f) } catch { /* no file is fine */ }
      expect(text).not.toMatch(/engine-strict/)
    }
  })
})
