// The pure part of publishLearnModules.ts: turns the Learn module pages (src/pages/learn/Module1.tsx…Module5.tsx)
// into the Markdown of the NIP-23 long-form articles. No Nostr, no keys, no network: unit tests and a local render
// import this file, never the publishing script.
//
// The parser only understands the small set of JSX tags actually used across the 5 modules (h2, h3, p, ul/ol/li,
// strong/em/code, <a>/<Link>, <KeyTakeaway>, and self-closing diagram components like <TokenFlowDiagram />). If a
// module starts using something outside that vocabulary, extend convertInline()/extractBlocks(): parseModule() throws
// when anything in the module body is left unconverted (single <div>, h1 matching the title, nothing dropped), so
// drift fails loudly instead of publishing something incomplete.

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { LEARN_MODULES } from '../shared/learnModules.js'

export interface LearnModuleSource {
  order: number
  file: string
  title: string
  summary: string
}

export interface ParsedModule {
  order: number
  title: string
  summary: string
  content: string
}

// Titles and summaries come from the shared Learn module list (the same text as the site), in order; the page of
// module N is ModuleN.tsx.
export const MODULE_META: readonly LearnModuleSource[] = [...LEARN_MODULES]
  .sort((a, b) => a.order - b.order)
  .map(m => ({ order: m.order, file: `Module${m.order}.tsx`, title: m.title, summary: m.summary }))

export function findModulesDir(): string {
  const override = process.env['LEARN_MODULES_DIR']
  if (override) {
    if (!existsSync(override)) throw new Error(`LEARN_MODULES_DIR set but not found: ${override}`)
    return override
  }
  // backend/src/scripts -> backend/src -> backend -> MintRadar -> src/pages/learn
  const candidate = path.join(__dirname, '..', '..', '..', 'src', 'pages', 'learn')
  if (existsSync(candidate)) return candidate
  throw new Error(
    `Learn modules directory not found at ${candidate}.\n` +
    `Set LEARN_MODULES_DIR to an explicit path instead.`
  )
}

// Converts the small set of inline JSX tags used in module content into Nostr-friendly Markdown. Order matters:
// <code> is converted last so it still works when nested inside an already-converted <a>/<Link> (e.g. Module 4's
// `<a href="..."><code>testnut.cashu.space</code></a>`).
export function convertInline(text: string): string {
  return text
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
    .replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
    .replace(/<Link to="([^"]+)"[^>]*>([\s\S]*?)<\/Link>/g, (_m, to: string, label: string) => `[${label}](https://mintradar.org${to})`)
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractListItems(listInner: string): string[] {
  return [...listInner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => convertInline(m[1]!))
}

// Top-level blocks, in source order. Order of the alternatives matters: the top-level <Link> must come before the
// generic self-closing component so it isn't mistaken for it; it is a standalone CTA element (e.g. Module 3's "Try the
// Best Mint Wizard" button), while a <Link> inside a <p> is handled by convertInline().
const BLOCK_RE = /<h2>([\s\S]*?)<\/h2>|<h3>([\s\S]*?)<\/h3>|<ol>([\s\S]*?)<\/ol>|<ul>([\s\S]*?)<\/ul>|<KeyTakeaway>([\s\S]*?)<\/KeyTakeaway>|<Link to="([^"]+)"[^>]*>([\s\S]*?)<\/Link>|<([A-Z]\w*)\s*\/>|<p>([\s\S]*?)<\/p>/g

// Walks the module body in source order, converting each top-level block to Markdown. The page's section headings
// are <h2> (the <h1> is the article title, sent separately), so <h2> becomes "##" and <h3> "###".
// Deliberately does NOT try to handle arbitrary/nested JSX — see file header.
export function extractBlocks(body: string): string[] {
  const blocks: string[] = []
  for (const match of body.matchAll(BLOCK_RE)) {
    const [, h2, h3, ol, ul, keyTakeaway, linkTo, linkLabel, selfClosingComponent, p] = match
    if (h2 !== undefined) {
      blocks.push(`## ${convertInline(h2)}`)
    } else if (h3 !== undefined) {
      blocks.push(`### ${convertInline(h3)}`)
    } else if (ol !== undefined) {
      blocks.push(extractListItems(ol).map((item, i) => `${i + 1}. ${item}`).join('\n'))
    } else if (ul !== undefined) {
      blocks.push(extractListItems(ul).map(item => `- ${item}`).join('\n'))
    } else if (keyTakeaway !== undefined) {
      // One line: the takeaway is usually bold as a whole, and bold split over several quoted lines breaks in some
      // Nostr clients (the sentences were one soft-wrapped paragraph anyway).
      blocks.push(['> 🔑 **Key takeaway**', '>', `> ${convertInline(keyTakeaway)}`].join('\n'))
    } else if (linkTo !== undefined) {
      blocks.push(`[${convertInline(linkLabel!)}](https://mintradar.org${linkTo})`)
    } else if (selfClosingComponent !== undefined) {
      blocks.push(`*(interactive diagram — best viewed at mintradar.org/learn)*`)
    } else if (p !== undefined) {
      blocks.push(convertInline(p))
    }
  }
  return blocks
}

/** What extractBlocks() would not convert: the body with every recognised block removed, whitespace collapsed. */
export function unconvertedText(body: string): string {
  return body.replace(BLOCK_RE, ' ').replace(/\s+/g, ' ').trim()
}

/** Parses one module page's source text (the contents of ModuleN.tsx). Throws on anything it cannot convert. */
export function parseModuleSource(meta: LearnModuleSource, src: string): ParsedModule {
  const divCount = (src.match(/<div\b/g) ?? []).length
  if (divCount !== 1) {
    throw new Error(`${meta.file}: expected exactly one <div> in module source, found ${divCount} — parser assumes no nested divs, extend extractBlocks() if this module now has one`)
  }

  const h1Match = src.match(/<h1>([\s\S]*?)<\/h1>/)
  if (!h1Match) throw new Error(`${meta.file}: no <h1> found`)
  const parsedTitle = convertInline(h1Match[1]!)
  if (parsedTitle !== meta.title) {
    throw new Error(`${meta.file}: <h1> is "${parsedTitle}" but the Learn module title is "${meta.title}" — update src/constants/learnModules.ts and backend/src/shared/learnModules.ts`)
  }

  const openTag = '<div className="learn-content">'
  const openIdx = src.indexOf(openTag)
  const closeIdx = src.lastIndexOf('</div>')
  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    throw new Error(`${meta.file}: could not locate learn-content div body`)
  }
  const body = src.slice(openIdx + openTag.length, closeIdx).replace(h1Match[0]!, '')

  const left = unconvertedText(body)
  if (left.length > 0) {
    throw new Error(`${meta.file}: content the parser does not convert (extend extractBlocks()): ${left.slice(0, 120)}`)
  }

  const content = extractBlocks(body).join('\n\n')
  if (content.length === 0) {
    throw new Error(`${meta.file}: parsed zero content blocks — parser likely doesn't recognize a tag this module uses`)
  }

  return { order: meta.order, title: meta.title, summary: meta.summary, content }
}

export function parseModule(meta: LearnModuleSource, modulesDir: string): ParsedModule {
  return parseModuleSource(meta, readFileSync(path.join(modulesDir, meta.file), 'utf-8'))
}

/** All modules, in order, from the module pages in modulesDir. */
export function parseAllModules(modulesDir: string): ParsedModule[] {
  return MODULE_META.map(meta => parseModule(meta, modulesDir))
}
