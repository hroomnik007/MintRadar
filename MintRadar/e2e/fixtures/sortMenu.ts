import { expect, type Page } from '@playwright/test'

// The Mints page sort control is our own list since 2026-11-20 (SortMenu, not a native <select>): open it and click the
// option by its label. The value keys are the URL's ?sort= values.
export const SORT_OPTION_LABEL = { reliability: 'Reliability', reviewCount: 'Most reviewed', rating: 'Rating', latency: 'Latency', name: 'Name' } as const
export type SortKey = keyof typeof SORT_OPTION_LABEL

export async function pickSort(page: Page, key: SortKey): Promise<void> {
  await page.locator('.sort-select').click()
  await page.getByRole('listbox', { name: 'Sort by' }).getByRole('option', { name: SORT_OPTION_LABEL[key], exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Sort by' })).toHaveCount(0)
  await expect(page.locator('.sort-select')).toContainText(`Sort: ${SORT_OPTION_LABEL[key]}`)
}
