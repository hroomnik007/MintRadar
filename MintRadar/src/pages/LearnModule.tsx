import { lazy, Suspense } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { LEARN_MODULES } from '@/constants/learnModules'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { LEARN_MODULE_NOT_FOUND_TITLE, learnModuleTitle } from '@/utils/pageMeta'
import './LearnModule.css'

const MODULE_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  'cashu-basics': lazy(() => import('@/pages/learn/Module1')),
  'understanding-the-risks': lazy(() => import('@/pages/learn/Module2')),
  'how-to-choose-a-mint': lazy(() => import('@/pages/learn/Module3')),
  'getting-started-with-a-wallet': lazy(() => import('@/pages/learn/Module4')),
  'safe-habits': lazy(() => import('@/pages/learn/Module5')),
}

const lazyFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
)

export default function LearnModule() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const navigate = useNavigate()

  const sorted = [...LEARN_MODULES].sort((a, b) => a.order - b.order)
  const numericRedirectTarget = moduleId && /^[1-9][0-9]*$/.test(moduleId)
    ? sorted.find(m => m.order === Number(moduleId))
    : undefined

  const index = sorted.findIndex(m => m.id === moduleId)
  const mod = index >= 0 ? sorted[index] : null
  const ModuleComponent = mod ? MODULE_COMPONENTS[mod.id] : null

  useDocumentMeta(
    mod ? learnModuleTitle(mod.title) : LEARN_MODULE_NOT_FOUND_TITLE,
    mod ? mod.summary : undefined,
    { notFound: mod === null, noindex: mod === null },
  )

  if (numericRedirectTarget) return <Navigate to={`/learn/${numericRedirectTarget.id}`} replace />

  if (!mod || !ModuleComponent) {
    return (
      <div className="learn-module-page">
        <article className="learn-module">
          <h1 className="sr-only">Module not found</h1>
          <div className="learn-not-found">
            Module not found. <Link to="/learn">Back to Learn</Link>
          </div>
        </article>
      </div>
    )
  }

  const prev = index > 0 ? sorted[index - 1] : null
  const next = index < sorted.length - 1 ? sorted[index + 1] : null

  return (
    <div className="learn-module-page">
      <article className="learn-module">
      <Link to="/learn" className="learn-back-link">← Back to Learn</Link>

      <Suspense fallback={lazyFallback}>
        <ModuleComponent />
      </Suspense>

      <div className="learn-module-nav">
        {prev ? (
          <button type="button" className="learn-nav-btn" onClick={() => navigate(`/learn/${prev.id}`)}>
            <span className="learn-nav-dir">← Previous</span>
            <span className="learn-nav-title">{prev.title}</span>
          </button>
        ) : <span />}
        {next ? (
          <button type="button" className="learn-nav-btn learn-nav-next" onClick={() => navigate(`/learn/${next.id}`)}>
            <span className="learn-nav-dir">Next:</span>
            <span className="learn-nav-title">{next.title}</span>
          </button>
        ) : (
          <button type="button" className="learn-nav-btn learn-nav-next" onClick={() => navigate('/')}>
            <span className="learn-nav-dir">Done →</span>
            <span className="learn-nav-title">Browse mints</span>
          </button>
        )}
      </div>
      </article>
    </div>
  )
}
