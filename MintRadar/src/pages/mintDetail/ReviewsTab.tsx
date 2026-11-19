// Mint Detail "Reviews" tab (2026-11-19 redesign, phase 4f): a summary (average, one bar per star, what a signed review
// means, the write button) beside the NIP-87 review list (filter switch, review cards with copy/open actions, pager).
// The review queries and relay subscriptions (GET /api/mints/nostr-reviews, useMintReviews, useVerifiedNip05),
// the filter / page / highlight / copied state, the review deep-link effect and the Write-a-review modal stay in
// MintDetail and are passed in or opened through setShowReviewModal, so fetch timing, caching, relay
// subscriptions and the lazy nostr-tools loading are unchanged. This component holds no state or hooks.
import type { Dispatch, SetStateAction } from 'react'
import { nip19 } from 'nostr-tools'
import { Copy, Check, ExternalLink, Link2, User } from 'lucide-react'
import { njumpEventUrl, npubFromPubkey } from '@/utils/nostrLinks'
import { REVIEW_READ_RELAYS } from '@/core/nostr/relays'
import { REVIEWS_NIP87_TEXT, OPERATOR_REVIEW_NOTE } from '@/utils/tooltipTexts'
import { showContactLabel, CONTACT_LISTED_LABEL } from '@/utils/reviewUtils'
import { reviewAvatarColor, avatarTextColor } from '@/utils/avatarColors'
import { avatarInitial } from '@/utils/npub'
import { shortNpub, formatReviewDate, starString, type MergedReviewCandidate } from './reviewFormat'

export type ReviewFilter = 'all' | '5star' | 'critical'

export interface ReviewsTabProps {
  url: string
  isLoggedIn: boolean
  setShowReviewModal: Dispatch<SetStateAction<boolean>>
  operatorListedCount: number
  reviewsLoading: boolean
  mergedReviews: MergedReviewCandidate[]
  storedReviewsFailed: boolean
  activeReviewFilter: ReviewFilter
  setReviewFilter: (type: ReviewFilter) => void
  reviewCountBase: MergedReviewCandidate[]
  reviewFilterFiveStarCount: number
  reviewFilterCriticalCount: number
  hideAnonActive: boolean
  toggleReviewHideAnon: () => void
  reviewFilterAnonCount: number
  filteredReviews: MergedReviewCandidate[]
  pagedReviews: MergedReviewCandidate[]
  highlightedReview: string | null
  verifiedNip05ByPubkey: Record<string, string>
  operatorKeys: ReadonlySet<string>
  contactListed: ReadonlySet<string>
  copiedReviewAction: string | null
  setCopiedReviewAction: Dispatch<SetStateAction<string | null>>
  reviewsPage: number
  reviewsTotalPages: number
  goToReviewsPage: (p: number) => void
  /** The summary beside the list (2026-11-19 redesign): the strip's numbers (operator reviews not counted) and the
   *  counted ratings per star, 5 first; `rated` 0 while the stored list has not loaded. */
  summary: { avg: number | null; count: number | null; rated: number; perStar: [number, number, number, number, number] }
}

export function ReviewsTab({
  url, isLoggedIn, setShowReviewModal, operatorListedCount, reviewsLoading,
  mergedReviews, storedReviewsFailed, activeReviewFilter, setReviewFilter, reviewCountBase,
  reviewFilterFiveStarCount, reviewFilterCriticalCount, hideAnonActive, toggleReviewHideAnon, reviewFilterAnonCount,
  filteredReviews, pagedReviews, highlightedReview, verifiedNip05ByPubkey, operatorKeys,
  contactListed, copiedReviewAction, setCopiedReviewAction, reviewsPage, reviewsTotalPages,
  goToReviewsPage, summary,
}: ReviewsTabProps) {
  const maxStar = Math.max(1, ...summary.perStar)
  const writeButton = isLoggedIn ? (
    <button type="button" className="reviews-write-btn" onClick={() => setShowReviewModal(true)}>Write a review</button>
  ) : (
    // Logged out: the same place says how to write one and opens the login dialog (AppShell listens).
    <button type="button" className="reviews-write-btn" data-testid="reviews-login-btn" onClick={() => window.dispatchEvent(new CustomEvent('mintradar:open-login'))}>
      Log in to write a review
    </button>
  )
  // 2026-11-19 redesign (phase 4f): the summary (average, counts, one bar per star, what a signed review means and the
  // write button) beside the list (one filter switch, a "Hide anonymous" check box, the reviews, "Page N of M").
  return (
    <div className="md-rv">
      <section className="md-panel md-rv-sum" aria-labelledby="md-rv-title">
        <h2 id="md-rv-title" className="sr-only">Reviews</h2>
        <div className="md-rv-avg">{summary.avg !== null ? summary.avg.toFixed(1) : '—'}</div>
        {summary.avg !== null && <div className="md-rv-stars" aria-label={`${summary.avg.toFixed(1)} out of 5`}>{starString(summary.avg)}</div>}
        <p className="md-rv-counts">
          {summary.count === null ? 'Loading reviews…'
            : summary.count === 0 ? 'No reviews yet'
            : `${summary.count} ${summary.count === 1 ? 'review' : 'reviews'}${summary.rated > 0 ? `, ${summary.rated} with a rating` : ''}`}
        </p>
        {summary.rated > 0 && (
          <div className="md-rv-hist" role="img" aria-label={summary.perStar.map((n, i) => `${5 - i} stars: ${n}`).join(', ')}>
            {summary.perStar.map((n, i) => (
              <div key={i} className="md-rv-hist-row">
                <span>{5 - i} ★</span>
                <span className="md-rv-meter"><i style={{ width: `${(n / maxStar) * 100}%` }} /></span>
                <span className="md-rv-hist-n">{n}</span>
              </div>
            ))}
          </div>
        )}
        <p className="reviews-disclaimer md-rv-note">Reviews are signed Nostr events (NIP-87): you can check who wrote one and that nobody changed it, not that it is true. {REVIEWS_NIP87_TEXT}</p>
        {operatorListedCount > 0 && <p className="reviews-disclaimer md-rv-note">{OPERATOR_REVIEW_NOTE}</p>}
        {writeButton}
      </section>

      <section className="md-panel md-rv-list" aria-label="Review list">
              {reviewsLoading ? (
                <div className="md-rv-empty">Loading reviews...</div>
              ) : mergedReviews.length === 0 ? (
                <div className="md-rv-empty">
                  {storedReviewsFailed ? 'Reviews are not available right now.' : 'No Nostr reviews found for this mint yet.'}
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:0}}>
                  <div className="reviews-filter-row">
                    <div className="reviews-filter-group md-seg" role="group" aria-label="Filter reviews by rating">
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'all' ? ' active on' : ''}`}
                        aria-pressed={activeReviewFilter === 'all'}
                        onClick={() => setReviewFilter('all')}
                      >All {reviewCountBase.length}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === '5star' ? ' active on' : ''}`}
                        aria-pressed={activeReviewFilter === '5star'}
                        onClick={() => setReviewFilter('5star')}
                      >5 stars {reviewFilterFiveStarCount}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'critical' ? ' active on' : ''}`}
                        aria-pressed={activeReviewFilter === 'critical'}
                        onClick={() => setReviewFilter('critical')}
                      >Critical {reviewFilterCriticalCount}</button>
                    </div>
                    <label className="md-rv-toggle">
                      <input type="checkbox" checked={hideAnonActive} onChange={toggleReviewHideAnon} />
                      Hide anonymous ({reviewFilterAnonCount})
                    </label>
                  </div>
                  {filteredReviews.length === 0 ? (
                    <div style={{fontSize:13,color:'var(--text3)'}}>No reviews match this filter.</div>
                  ) : (
                    <>
                  {pagedReviews.map(r => {
                    const npub = nip19.npubEncode(r.pubkey)
                    const profile = r.profile
                    const displayName = profile?.name ?? shortNpub(npub)
                    // No usable name: a User icon, not the "N" of "npub" on every anonymous reviewer.
                    const initial = avatarInitial(profile?.name)
                    return (
                      <div key={r.id} id={`review-${r.id}`} className={`review-card${highlightedReview === r.id ? ' review-card-hl' : ''}`}>
                        <div className="review-card-header">
                          <div className="review-avatar">
                            <div className="review-avatar-fallback" style={{ background: reviewAvatarColor(r.pubkey), color: avatarTextColor(reviewAvatarColor(r.pubkey)) }}>{initial ?? <User size={16} strokeWidth={2.4} aria-hidden="true" />}</div>
                            {profile?.picture?.startsWith('https://') && (
                              <img src={profile.picture} alt="" className="review-avatar-img" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }} />
                            )}
                          </div>
                          <div className="review-author">
                            <span className="review-author-name">
                              <span className="review-author-name-text">
                                {displayName}
                                {profile?.name && verifiedNip05ByPubkey[r.pubkey] && (
                                  <span className="review-author-nip05">{verifiedNip05ByPubkey[r.pubkey]}</span>
                                )}
                                {profile?.fromServer && profile.nip05 && !verifiedNip05ByPubkey[r.pubkey] && (
                                  <span className="review-author-nip05-claimed">claimed NIP-05: {profile.nip05}</span>
                                )}
                              </span>
                              {operatorKeys.has(r.pubkey.toLowerCase()) && (
                                <span className="review-operator-badge">Operator</span>
                              )}
                            </span>
                            {/* Without a profile name the name line already is the short npub: not the same text twice. */}
                            {profile?.name && <span className="review-author-npub">{shortNpub(npub)}</span>}
                            {showContactLabel(r.pubkey, contactListed, operatorKeys) && (
                              <span className="review-contact-label">{CONTACT_LISTED_LABEL}</span>
                            )}
                          </div>
                          <div className="review-meta">
                            {r.rating !== null && (
                              <span className="review-stars">{starString(r.rating)}</span>
                            )}
                            <span className="review-date">{formatReviewDate(r.createdAt)}</span>
                            <span className="review-actions">
                              <button
                                type="button"
                                className="review-action-btn"
                                title="Copy reviewer npub"
                                aria-label="Copy reviewer npub"
                                onClick={e => {
                                  e.preventDefault()
                                  const np = npubFromPubkey(r.pubkey)
                                  if (!np) return
                                  void navigator.clipboard.writeText(np).then(() => {
                                    setCopiedReviewAction(r.id + '-npub')
                                    window.setTimeout(() => setCopiedReviewAction(null), 1500)
                                  })
                                }}
                              >{copiedReviewAction === r.id + '-npub' ? <Check size={13} /> : <Copy size={13} />}</button>
                              {njumpEventUrl(r.id, { relays: REVIEW_READ_RELAYS, author: r.pubkey }) && (
                                <a
                                  href={njumpEventUrl(r.id, { relays: REVIEW_READ_RELAYS, author: r.pubkey })!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="review-action-btn"
                                  title="Open this review on Nostr"
                                  aria-label="Open this review on Nostr"
                                ><ExternalLink size={13} /></a>
                              )}
                              <button
                                type="button"
                                className="review-action-btn"
                                title="Copy link to this review"
                                aria-label="Copy link to this review"
                                onClick={e => {
                                  e.preventDefault()
                                  const permalink = `${window.location.origin}/mint/${encodeURIComponent(url)}#review-${r.id}`
                                  void navigator.clipboard.writeText(permalink).then(() => {
                                    setCopiedReviewAction(r.id + '-link')
                                    window.setTimeout(() => setCopiedReviewAction(null), 1500)
                                  })
                                }}
                              >{copiedReviewAction === r.id + '-link' ? <Check size={13} /> : <Link2 size={13} />}</button>
                            </span>
                          </div>
                        </div>
                        {r.comment ? <p className="review-comment">{r.comment}</p>
                          : r.rating !== null ? <p className="review-no-comment">Rated without a comment.</p> : null}
                      </div>
                    )
                  })}
                  {reviewsTotalPages > 1 && (
                    <nav className="reviews-pagination" aria-label="Reviews pages">
                      <button
                        type="button"
                        className="reviews-page-btn"
                        disabled={reviewsPage === 1}
                        onClick={() => goToReviewsPage(reviewsPage - 1)}
                        aria-label="Previous page"
                      >‹</button>
                      <span className="reviews-page-of" aria-current="page">Page {reviewsPage} of {reviewsTotalPages}</span>
                      <button
                        type="button"
                        className="reviews-page-btn"
                        disabled={reviewsPage === reviewsTotalPages}
                        onClick={() => goToReviewsPage(reviewsPage + 1)}
                        aria-label="Next page"
                      >›</button>
                    </nav>
                  )}
                    </>
                  )}
                </div>
              )}
      </section>
    </div>
  )
}
