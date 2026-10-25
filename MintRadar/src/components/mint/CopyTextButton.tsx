import { useEffect, useRef, useState } from 'react'
import '@/pages/DocPage.css'

// A labelled copy button with the site's copy-button pattern (the one of the code blocks on /for-wallets, see CodeBlock.tsx):
// class `doc-copy-btn` (32 px, 44 px on touch), the label turns into "Copied" or "Copy failed" for two seconds,
// aria-label "<label>: <what>" (starts with the visible label, WCAG 2.5.3 label-in-name; with label "Copy" that is
// the old "Copy: <what>"), and a polite status for screen readers.

const FEEDBACK_MS = 2000

interface Props {
  /** The idle label, "Copy" or "Copy <short name>" when several buttons sit side by side. */
  label: string
  /** What is copied, for the accessible name: "<label>: <what>". */
  what: string
  value: string
}

export function CopyTextButton({ label, what, value }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy(): Promise<void> {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => { timer.current = null; setState('idle') }, FEEDBACK_MS)
  }

  return (
    <>
      <button type="button" className="doc-copy-btn" onClick={() => { void copy() }} aria-label={`${label}: ${what}`}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      </button>
      <span className="doc-sr-only" role="status">{state === 'copied' ? 'Copied to the clipboard' : state === 'failed' ? 'Copy failed' : ''}</span>
    </>
  )
}
