// Honest labels for single values on the mint card and in Compare (data audit 2026-10-25).

/** The Compare uptime row is the server's 24 h figure (the same window as Mint Detail's header). */
export const COMPARE_UPTIME_LABEL = 'Uptime 24h'
/** Compare and card latency is one sample: the latest check, not an average. */
export const COMPARE_LATENCY_LABEL = 'Latency (last check)'
export const COMPARE_LATENCY_TITLE = 'Latency of the last check (one sample)'
/** The card's latency label while a measured value is shown. */
export const CARD_LATENCY_LABEL = 'Latency (last check)'
/** Compare's audit row (renamed 2026-10-25 from "Audit success"): the x / y of swaps WITHOUT a failure attributed to
 *  the mint in cashu.info's 7-day window — the Audit tab's "Without a failure caused by this mint" tile as a ratio, not
 *  its Deposits / Withdrawals success counts (those count every failure). Fits the 160 px desktop label column with ⓘ. */
export const COMPARE_AUDIT_LABEL = 'No mint fault (7d)'
