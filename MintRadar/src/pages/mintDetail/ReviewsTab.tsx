// Mint Detail "Reviews" tab: the NIP-87 review list (filter chips, review cards with copy/open actions, pager).
// Extracted verbatim from MintDetail.tsx (pure refactor: same DOM, classes, inline styles, aria and tooltips).
// The review queries and relay subscriptions (GET /api/mints/nostr-reviews, useMintReviews, useVerifiedNip05),
// the filter / page / highlight / copied state, the review deep-link effect and the Write-a-review modal stay in
// MintDetail and are passed in or opened through setShowReviewModal, so fetch timing, caching, relay
// subscriptions and the lazy nostr-tools loading are unchanged. This component holds no state or hooks.
import type { Dispatch, SetStateAction } from 'react'
import { nip19 } from 'nostr-tools'
import { Copy, Check, ExternalLink, Link2 } from 'lucide-react'
import { njumpEventUrl, npubFromPubkey } from '@/utils/nostrLinks'
import { InfoTooltip } from '@/components/InfoTooltip'
import { REVIEWS_NIP87_TEXT, OPERATOR_REVIEW_NOTE } from '@/utils/tooltipTexts'
import { showContactLabel, CONTACT_LISTED_LABEL } from '@/utils/reviewUtils'
import { reviewAvatarColor, avatarTextColor } from '@/utils/avatarColors'
import { shortNpub, formatReviewDate, starString, reviewPageList, type MergedReviewCandidate } from './reviewFormat'

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
}

export function ReviewsTab({
  url, isLoggedIn, setShowReviewModal, operatorListedCount, reviewsLoading,
  mergedReviews, storedReviewsFailed, activeReviewFilter, setReviewFilter, reviewCountBase,
  reviewFilterFiveStarCount, reviewFilterCriticalCount, hideAnonActive, toggleReviewHideAnon, reviewFilterAnonCount,
  filteredReviews, pagedReviews, highlightedReview, verifiedNip05ByPubkey, operatorKeys,
  contactListed, copiedReviewAction, setCopiedReviewAction, reviewsPage, reviewsTotalPages,
  goToReviewsPage,
}: ReviewsTabProps) {
  return (
            <div className="md-panel">
              <div className="reviews-header">
                <div className="md-panel-title" style={{marginBottom:0}}>Reviews</div>
                {isLoggedIn && (
                  <button className="reviews-write-btn" onClick={() => setShowReviewModal(true)}>
                    Write a review
                  </button>
                )}
              </div>
              <div className="reviews-disclaimer" style={{display:'flex',alignItems:'center',gap:5}}>
                <span>Reviews · NIP-87</span>
                <InfoTooltip
                  width={260}
                  label="About NIP-87 reviews"
                  text={REVIEWS_NIP87_TEXT}
                />
              </div>
              {operatorListedCount > 0 && <div className="reviews-disclaimer">{OPERATOR_REVIEW_NOTE}</div>}
              {reviewsLoading ? (
                <div style={{fontSize:13,color:'var(--text3)',marginTop:8}}>Loading reviews...</div>
              ) : mergedReviews.length === 0 ? (
                <div style={{fontSize:13,color:'var(--text3)',marginTop:8}}>
                  {storedReviewsFailed ? 'Reviews are not available right now.' : 'No Nostr reviews found for this mint yet.'}
                </div>
              ) : (
                <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
                  <div className="reviews-filter-row">
                    <div
                      className="reviews-filter-group"
                      role="group"
                      aria-label="Filter reviews by rating"
                    >
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'all' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === 'all'}
                        onClick={() => setReviewFilter('all')}
                      >All · {reviewCountBase.length}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === '5star' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === '5star'}
                        onClick={() => setReviewFilter('5star')}
                      >5★ · {reviewFilterFiveStarCount}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'critical' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === 'critical'}
                        onClick={() => setReviewFilter('critical')}
                      >Critical · {reviewFilterCriticalCount}</button>
                    </div>
                    <button
                      type="button"
                      className={`reviews-filter-chip toggle${hideAnonActive ? ' active' : ''}`}
                      aria-pressed={hideAnonActive}
                      onClick={toggleReviewHideAnon}
                    >Hide anon · {reviewFilterAnonCount}</button>
                  </div>
                  {filteredReviews.length === 0 ? (
                    <div style={{fontSize:13,color:'var(--text3)'}}>No reviews match this filter.</div>
                  ) : (
                    <>
                  {pagedReviews.map(r => {
                    const npub = nip19.npubEncode(r.pubkey)
                    const profile = r.profile
                    const displayName = profile?.name ?? shortNpub(npub)
                    const initial = (profile?.name ?? npub).slice(0, 1).toUpperCase()
                    return (
                      <div key={r.id} id={`review-${r.id}`} className={`review-card${highlightedReview === r.id ? ' review-card-hl' : ''}`}>
                        <div className="review-card-header">
                          <div className="review-avatar">
                            <div className="review-avatar-fallback" style={{ background: reviewAvatarColor(r.pubkey), color: avatarTextColor(reviewAvatarColor(r.pubkey)) }}>{initial}</div>
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
                            <span className="review-author-npub">{shortNpub(npub)}</span>
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
                              {njumpEventUrl(r.id) && (
                                <a
                                  href={njumpEventUrl(r.id)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="review-action-btn"
                                  title="Open this review on Nostr"
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
                        {r.comment && <p className="review-comment">{r.comment}</p>}
                      </div>
                    )
                  })}
                  {reviewsTotalPages > 1 && (
                    <nav className="reviews-pagination" aria-label="Reviews pages">
                      <button
                        className="reviews-page-btn"
                        disabled={reviewsPage === 1}
                        onClick={() => goToReviewsPage(reviewsPage - 1)}
                        aria-label="Previous page"
                      >‹</button>
                      {reviewPageList(reviewsPage, reviewsTotalPages).map((p, i) =>
                        p === '…'
                          ? <span key={`gap-${i}`} className="reviews-page-ellipsis">…</span>
                          : (
                            <button
                              key={p}
                              className={`reviews-page-btn${p === reviewsPage ? ' active' : ''}`}
                              aria-current={p === reviewsPage ? 'page' : undefined}
                              onClick={() => goToReviewsPage(p)}
                            >{p}</button>
                          ),
                      )}
                      <button
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
            </div>
  )
}
