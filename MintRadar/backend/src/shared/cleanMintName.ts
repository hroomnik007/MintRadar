// Display cleaning for mint names. A mint's `name` comes straight from its own (untrusted) /v1/info,
// so what we SHOW is cleaned: control / zero-width / bidi / variation-selector abuse removed, whitespace
// collapsed, long names and emoji spam capped. Stored database values are never touched.
//
// Source of truth for the backend (mintNames.ts applies it where names leave the server). The frontend
// cannot import this file (separate npm package, no workspace), so src/utils/cleanMintName.ts is a
// manually-synced copy — keep the code identical; src/__tests__/sharedModules.test.ts fails when the
// two drift.

export const MAX_NAME_GRAPHEMES = 48
export const MAX_EMOJI_RUN = 3
const ELLIPSIS = '\u2026'

// C0/C1 controls and DEL; zero-width and invisible formatters (ZWSP, ZWNJ, ZWJ, word joiner, BOM,
// soft hyphen, invisible math operators, Mongolian vowel separator); bidi marks, embeddings,
// overrides and isolates; blank "filler" glyphs; Unicode tag characters.
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu
// Variation selectors: U+FE00-FE0F and U+E0100-E01EF. One U+FE0E/U+FE0F straight after a visible
// character is normal emoji/text presentation and is kept; everything else is abuse (runs, lone ones).
const VS_RE = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u

const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}])/u

function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(x: string): Iterable<{ segment: string }> } }).Segmenter
  if (typeof Seg === 'function') {
    return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), x => x.segment)
  }
  return Array.from(s)
}

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function stripVariationAbuse(s: string): string {
  let out = ''
  let prevVisible = false
  let prevWasVs = false
  for (const ch of s) {
    if (VS_RE.test(ch)) {
      const keep = (ch === '\uFE0E' || ch === '\uFE0F') && prevVisible && !prevWasVs
      if (keep) out += ch
      prevWasVs = true
      continue
    }
    prevWasVs = false
    prevVisible = ch.trim() !== ''
    out += ch
  }
  return out
}

export interface CleanedMintName {
  /** What to display ('' when nothing displayable is left and no url fallback was given). */
  name: string
  /** The full cleaned name, only when `name` differs from it (truncated or emoji-capped) — for a title tooltip. */
  full: string | null
}

export function cleanMintNameDetailed(raw: string | null | undefined, url: string): CleanedMintName {
  const nfc = typeof raw === 'string' ? raw.normalize('NFC') : ''
  // The "control-character-cleaned form": NFC, no controls/invisibles/bidi/VS abuse, one space between words.
  const cleaned = stripVariationAbuse(nfc.replace(STRIP_RE, '')).replace(/\s+/g, ' ').trim()
  if (cleaned === '') return { name: hostOf(url), full: null }

  const parts = graphemes(cleaned)
  // More than MAX_EMOJI_RUN emoji/pictographs in a row: keep the first MAX_EMOJI_RUN.
  const capped: string[] = []
  let run = 0
  for (const g of parts) {
    if (EMOJI_RE.test(g)) {
      run++
      if (run > MAX_EMOJI_RUN) continue
    } else {
      run = 0
    }
    capped.push(g)
  }
  let name = capped.join('')
  if (capped.length > MAX_NAME_GRAPHEMES) {
    name = capped.slice(0, MAX_NAME_GRAPHEMES - 1).join('') + ELLIPSIS
  }
  return { name, full: name === cleaned ? null : cleaned }
}

/** The display name: cleaned, capped, or the hostname of `url` when nothing displayable is left. */
export function cleanMintName(raw: string | null | undefined, url: string): string {
  return cleanMintNameDetailed(raw, url).name
}
