/** Current Arcaea v7 B50: top 10 are counted twice, then divided by 60. */
export function calculateWeightedPotential(ratings: number[]) {
  const ordered = [...ratings].sort((a, b) => b - a).slice(0, 50);
  const topTen = ordered.slice(0, 10).reduce((sum, value) => sum + value, 0);
  const remaining = ordered.slice(10).reduce((sum, value) => sum + value, 0);
  return ordered.length === 0 ? 0 : (topTen * 2 + remaining) / 60;
}

export function formatPotential(value: number) {
  return Math.floor(value * 1000) / 1000;
}
