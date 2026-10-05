import { Link } from 'react-router-dom'
import { LEARN_MODULES } from '@/constants/learnModules'
import { LearnModuleIcon, LearnHero } from '@/components/learn/LearnIcons'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import './Learn.css'

export default function Learn() {
  const modules = [...LEARN_MODULES].sort((a, b) => a.order - b.order)

  useDocumentMeta(
    'Learn Cashu - MintRadar',
    'A short course on how Cashu works, what can go wrong, and how to choose a safe Cashu mint.'
  )

  return (
    <div className="learn-page">
      <div className="learn-page-header">
        <h1 className="learn-page-title">Learn</h1>
        <div className="learn-page-subtitle">A short course on how Cashu works, what can go wrong, and how to choose a safe Cashu mint.</div>
      </div>

      <div className="learn-hero" aria-hidden="true">
        <LearnHero />
      </div>

      <div className="learn-grid">
        {modules.map(mod => (
          <div key={mod.id} className="learn-card">
            <div className="learn-card-head">
              <LearnModuleIcon moduleId={mod.id} />
              <span className="learn-card-number">Module {mod.order}</span>
            </div>
            <div className="learn-card-title">
              {/* Stretched link: .learn-card-link::after covers the whole card (Learn.css). */}
              <Link className="learn-card-link" to={`/learn/${mod.id}`}>{mod.title}</Link>
            </div>
            <div className="learn-card-summary">{mod.summary}</div>
            <div className="learn-card-cta">Start module →</div>
          </div>
        ))}
      </div>
    </div>
  )
}
