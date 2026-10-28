// The NUT description and the spec link, shared by the Mint Detail NUT modal and the Stats NUT coverage modal so
// both show the same text from the one catalog (pages/mintDetail/nutCatalog.ts).
import { NUT_DESCRIPTIONS } from '@/pages/mintDetail/nutCatalog'

/** The one-sentence NUT description; nothing when the NUT is not in the catalog. */
export function NutDescription({ nut }: { nut: string }) {
  const desc = NUT_DESCRIPTIONS[nut]?.desc
  return desc ? <p className="nm-desc">{desc}</p> : null
}

/** "View NUT spec on GitHub" link for a NUT-NN id. */
export function NutSpecLink({ nut }: { nut: string }) {
  return (
    <a
      className="nm-link"
      href={`https://github.com/cashubtc/nuts/blob/main/${parseInt(nut.replace('NUT-', ''), 10).toString().padStart(2, '0')}.md`}
      target="_blank"
      rel="noopener noreferrer"
    >
      ↗ View NUT spec on GitHub
    </a>
  )
}
