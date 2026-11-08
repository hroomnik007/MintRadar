// True on a phone or tablet browser. Used to offer "Open in signer app" (a nostrconnect:// link only
// does something where a signer app can take the intent). userAgentData.mobile is exact where the
// browser provides it (Chromium incl. Brave on Android); the user-agent test covers the rest (Safari).
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (typeof uaData?.mobile === 'boolean') return uaData.mobile
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}
