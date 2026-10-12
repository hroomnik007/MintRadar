import { useEffect, useRef, useState } from 'react'

// A code block for the documentation pages: the code scrolls sideways INSIDE the block (never the page) and a
// button copies it. Copy feedback follows the pattern of the account menu: the label turns into "Copied" or
// "Copy failed" (clipboard denied or unavailable) for two seconds.

const FEEDBACK_MS = 2000

interface Props {
  /** Short name shown above the code and used in the accessible names ("curl", "JavaScript"). */
  label: string
  code: string
  /** What the block is, for the accessible names of the scroll box and the button. */
  title: string
}

export function CodeBlock({ label, code, title }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy(): Promise<void> {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(code)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => { timer.current = null; setState('idle') }, FEEDBACK_MS)
  }

  return (
    <div className="doc-code">
      <div className="doc-code-head">
        <span>{label}</span>
        <button type="button" className="doc-copy-btn" onClick={() => { void copy() }} aria-label={`Copy: ${title}`}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
        <span className="doc-sr-only" role="status">{state === 'copied' ? 'Copied to the clipboard' : state === 'failed' ? 'Copy failed' : ''}</span>
      </div>
      <pre className="doc-code-pre" tabIndex={0} aria-label={title}><code>{code}</code></pre>
    </div>
  )
}
