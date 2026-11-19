import { Link } from 'react-router-dom'
import { LEARN_MODULES } from '@/constants/learnModules'
import { PageHead } from '@/components/layout/PageHead'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { ROUTE_META_BY_PATH } from '@/utils/pageMeta'
import './Learn.css'

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
/** "Five" for 5 (a sentence starts with the count); digits above ten. */
const countWord = (n: number): string => WORDS[n] ?? String(n)

// 2026-11-19 redesign (phase 6b): the modules are a real sequence, so they are a numbered list (like a table of
// contents), not a card grid; "The short version" beside it is for a reader who will not take the course.
export default function Learn() {
  const modules = [...LEARN_MODULES].sort((a, b) => a.order - b.order)
  const totalMinutes = modules.reduce((s, m) => s + m.readingMinutes, 0)

  useDocumentMeta(ROUTE_META_BY_PATH['/learn'].title, ROUTE_META_BY_PATH['/learn'].description)

  return (
    <div className="learn-page">
      <PageHead
        className="learn-page-header"
        titleClassName="learn-page-title"
        descriptionClassName="learn-page-subtitle"
        title="Learn"
        description={`How Cashu works, what can go wrong, and how to choose a mint. ${countWord(modules.length)} short modules, about ${totalMinutes} minutes in all.`}
      />

      <div className="learn-course">
        <ol className="learn-modules">
          {modules.map(mod => (
            <li key={mod.id} className="learn-mod">
              <span className="learn-mod-num" aria-hidden="true">{mod.order}</span>
              <div className="learn-mod-body">
                <h2 className="learn-mod-title">
                  {/* Stretched link: .learn-mod-link::after covers the whole row (Learn.css). */}
                  <Link className="learn-mod-link" to={`/learn/${mod.id}`}>{mod.title}</Link>
                </h2>
                <p className="learn-mod-summary">{mod.summary}</p>
                <span className="learn-mod-go" aria-hidden="true">Read module {mod.order}</span>
              </div>
              <span className="learn-mod-len">{mod.readingMinutes} min</span>
            </li>
          ))}
        </ol>
        <aside className="learn-aside" aria-labelledby="learn-aside-title">
          <h2 id="learn-aside-title" className="learn-aside-title">The short version</h2>
          <ol>
            <li>A mint holds your bitcoin. If it disappears, so do your sats.</li>
            <li>Keep only spending money in any one mint.</li>
            <li>Check a mint's uptime and score before you deposit.</li>
          </ol>
        </aside>
      </div>
    </div>
  )
}
