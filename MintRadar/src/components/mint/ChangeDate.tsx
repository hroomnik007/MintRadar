import type { DateMark, PendingMark } from '@/utils/changeDates'

// The small muted date next to a value on Mint Detail ("since 23 Oct", "last changed 21 Oct"): short local date in the row,
// the full local and UTC time in the title. And the tag of a value seen once: "seen 2h ago, not confirmed yet", never a date.

export function ChangeDate({ prefix, mark, testId }: { prefix: string; mark: DateMark; testId?: string }) {
  return (
    <span className="md-chg-date" data-testid={testId} title={mark.title}>
      {prefix} <time dateTime={mark.iso}>{mark.label}</time>
    </span>
  )
}

export function PendingTag({ mark, testId = 'pending-tag' }: { mark: PendingMark; testId?: string }) {
  return (
    <span className="md-chg-pending" data-testid={testId} title={mark.title}>
      <time dateTime={mark.iso}>{mark.text}</time>
    </span>
  )
}
