/** Current Arcaea v7 B50: top 10 are counted twice, then divided by 60.
 * Lowiro reports single-song ratings with sub-milli precision (e.g.
 * 13.307065), so the quotient is meaningful well past the 3rd decimal. */
export function calculateWeightedPotential(ratings: number[]) {
  const ordered = [...ratings].sort((a, b) => b - a).slice(0, 50);
  const topTen = ordered.slice(0, 10).reduce((sum, value) => sum + value, 0);
  const remaining = ordered.slice(10).reduce((sum, value) => sum + value, 0);
  return ordered.length === 0 ? 0 : (topTen * 2 + remaining) / 60;
}

/** Weighted potential straight from a stored B50, without the storage-time
 * truncation — the /60 division repeats, so display needs the raw value. */
export function exactWeightedPotential(best50: ReadonlyArray<{ rating: number }>) {
  return calculateWeightedPotential(best50.map(score => score.rating));
}

export function formatPotential(value: number) {
  return Math.floor(value * 1000) / 1000;
}
