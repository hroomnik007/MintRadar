import { contactChecksLine, type ContactCheckFact } from '@/utils/contactChecks'

/** One muted line of facts under the contact information on Mint Detail; nothing at all when no check exists. */
export function ContactChecksLine({ checks, now }: { checks: readonly ContactCheckFact[] | null | undefined; now: number }) {
  const line = contactChecksLine(checks, now)
  if (!line) return null
  return (
    <div className="md-contact-checks" data-testid="contact-checks">
      Contact checks: {line.segments.join(' · ')}
      {line.checked && <>{' · '}<span title={line.checked.title}>checked {line.checked.label}</span></>}
    </div>
  )
}
