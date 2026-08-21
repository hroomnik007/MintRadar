import { useNavigate } from 'react-router-dom'
import { LEARN_MODULES } from '@/constants/learnModules'
import './Learn.css'

export default function Learn() {
  const navigate = useNavigate()
  const modules = [...LEARN_MODULES].sort((a, b) => a.order - b.order)

  return (
    <div className="learn-page">
      <div className="learn-page-header">
        <div className="learn-page-title">Learn</div>
        <div className="learn-page-subtitle">A short course on how Cashu works, what can go wrong, and how to use it safely.</div>
      </div>

      <div className="learn-grid">
        {modules.map(mod => (
          <div
            key={mod.id}
            className="learn-card"
            onClick={() => navigate(`/learn/${mod.id}`)}
          >
            <div className="learn-card-number">Module {mod.order}</div>
            <div className="learn-card-title">{mod.title}</div>
            <div className="learn-card-summary">{mod.summary}</div>
            <div className="learn-card-cta">Start module →</div>
          </div>
        ))}
      </div>
    </div>
  )
}
