// One-time backfill: derive units/mint_methods/melt_methods for all mints
// that already have nuts_limits data, but predate the columns' introduction.
// Pure re-parse of data already in the DB — no network calls.
import { pool } from '../db.js'
import { parseMintMethods } from '../prober.js'

async function main(): Promise<void> {
  const res = await pool.query(
    `SELECT url, nuts_limits FROM mints
     WHERE nuts_limits IS NOT NULL
       AND units IS NULL AND mint_methods IS NULL AND melt_methods IS NULL`
  )
  const rows = res.rows as { url: string; nuts_limits: Record<string, unknown> }[]
  console.log(`[backfill] ${rows.length} mints to process`)

  let updated = 0
  for (const row of rows) {
    const { units, mintMethods, meltMethods } = parseMintMethods(row.nuts_limits)
    if (units === null && mintMethods === null && meltMethods === null) continue
    await pool.query(
      `UPDATE mints SET units = $1::jsonb, mint_methods = $2::jsonb, melt_methods = $3::jsonb WHERE url = $4`,
      [
        units !== null ? JSON.stringify(units) : null,
        mintMethods !== null ? JSON.stringify(mintMethods) : null,
        meltMethods !== null ? JSON.stringify(meltMethods) : null,
        row.url,
      ]
    )
    updated++
  }
  console.log(`[backfill] updated ${updated}/${rows.length} mints`)
  await pool.end()
}

main().catch(err => {
  console.error('[backfill] failed:', err)
  process.exit(1)
})
