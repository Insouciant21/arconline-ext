import variants from "./score-result-characters.json";
import type { ScoreExportHint, StoredUser } from "./types";

const available = new Set(variants);

export function characterAssetId(user: ScoreExportHint) {
  if (!Number.isSafeInteger(user.characterId) || (user.characterId ?? -1) < 0) return null;
  const suffix = user.characterUncapped && !user.characterUncappedOverride ? "u" : "";
  const id = `${user.characterId}${suffix}`;
  return available.has(id) ? id : available.has(String(user.characterId)) ? String(user.characterId) : null;
}

// A cached hint schedules image downloads only. The freshly fetched profile
// remains authoritative for every pixel and displayed value in the export.
export function scoreExportHint(user: StoredUser): ScoreExportHint {
  const { rating, characterId, characterUncapped, characterUncappedOverride, bannerResource } = user;
  return { rating, characterId, characterUncapped, characterUncappedOverride, bannerResource };
}
