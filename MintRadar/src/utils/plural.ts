/** "1 mint", "2 mints", "0 mints": the noun in the right number for a count. `plural` is for irregular nouns. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
