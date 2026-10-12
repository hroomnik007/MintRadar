// Contact details shown on the /methodology and /for-wallets pages. They repeat the contact card of
// pages/About.tsx word for word (npub, NIP-05 address, repository); src/__tests__/methodologyPage.test.ts fails
// when About.tsx stops containing the same values.
export const REPO_URL = 'https://github.com/hroomnik007/MintRadar'
export const CONTACT_NPUB = 'npub1zatej55x47xzhnw06yarqr5ugz7y5el8vygcckek24e5qmrtx77qnmd6rg'
export const CONTACT_NIP05 = 'wildcitizen7@mintradar.org'
/** Same blob URL pattern as the footer "API" link. */
export const REPO_BLOB_URL = `${REPO_URL}/blob/main/MintRadar`
