// The Nostr profile pictures of the Alerts and Health service accounts must point to a file that exists in public/:
// a PNG of 512 x 512 px. The file name is frozen (clients cache avatars by path), see
// docs/claude/design-palette-and-chrome.md, "Not covered".
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const ALERTS = /picture:\s*'(https:\/\/mintradar\.org\/[^']+)'/.exec(read('backend/src/nostrService.ts'))?.[1]
const HEALTH = /ATTESTATION_PROFILE_PICTURE_URL\s*=\s*'(https:\/\/mintradar\.org\/[^']+)'/.exec(read('backend/src/healthAssertions.ts'))?.[1]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('Nostr profile pictures', () => {
  it('finds both picture URLs', () => {
    expect(ALERTS).toBeDefined()
    expect(HEALTH).toBeDefined()
  })

  for (const [label, url] of [['Alerts', ALERTS], ['Health', HEALTH]] as const) {
    it(`${label}: the picture is an existing 512 x 512 PNG in public/`, () => {
      const file = path.join(ROOT, 'public', new URL(url ?? '').pathname)
      expect(fs.existsSync(file), `${url} has no file ${file}`).toBe(true)
      const b = fs.readFileSync(file)
      expect(b.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature').toBe(true)
      expect(b.subarray(12, 16).toString('ascii'), 'IHDR chunk').toBe('IHDR')
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([512, 512])
    })
  }
})
