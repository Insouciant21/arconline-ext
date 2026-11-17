import catalogData from "./song-catalog.json";
import { chartConstantForSong } from "./chart-constants";

export interface CatalogDifficulty {
  difficulty: number;
  rating: number;
  ratingPlus?: boolean;
  alias?: number;
  title?: string;
  artist?: string;
}

export interface CatalogSong {
  id: string;
  title: string;
  ja?: string;
  artist: string;
  version?: string;
  difficulties: CatalogDifficulty[];
  search?: string[];
}

interface IndexedSong {
  song: CatalogSong;
  idLower: string;
  titleLower: string;
  jaLower: string;
  artistLower: string;
  extraTitlesLower: string[];
  searchLower: string[];
  combinedLower: string;
  maxConstant: number;
}

const catalog = catalogData as CatalogSong[];
const songMap = new Map<string, CatalogSong>();
const indexedCatalog: IndexedSong[] = catalog.map((song) => {
  songMap.set(song.id, song);
  const idLower = song.id.toLowerCase();
  const titleLower = song.title.toLowerCase();
  const jaLower = (song.ja ?? "").toLowerCase();
  const artistLower = song.artist.toLowerCase();
  const extraTitlesLower = song.difficulties
    .flatMap((diff) => [diff.title, diff.artist])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const searchLower = (song.search ?? []).map((value) => value.toLowerCase());
  const combinedLower = [idLower, titleLower, jaLower, artistLower, ...extraTitlesLower, ...searchLower]
    .filter(Boolean)
    .join("\n");
  const maxConstant = song.difficulties.reduce((max, diff) => {
    const constant = chartConstantForSong(song.id, diff.difficulty) ?? diff.rating;
    return Math.max(max, constant);
  }, 0);

  return {
    song,
    idLower,
    titleLower,
    jaLower,
    artistLower,
    extraTitlesLower,
    searchLower,
    combinedLower,
    maxConstant,
  };
});

export function getSongCatalog(): ReadonlyArray<CatalogSong> {
  return catalog;
}

export function getSongById(songId: string): CatalogSong | undefined {
  return songMap.get(songId);
}

export function getCatalogDifficulty(song: CatalogSong, difficulty: number): CatalogDifficulty | undefined {
  return song.difficulties.find((item) => item.difficulty === difficulty);
}

export function displaySongTitle(song: CatalogSong, difficulty?: number): string {
  if (difficulty !== undefined) {
    const diff = getCatalogDifficulty(song, difficulty);
    if (diff?.title) return diff.title;
  }
  return song.title;
}

export function displaySongArtist(song: CatalogSong, difficulty?: number): string {
  if (difficulty !== undefined) {
    const diff = getCatalogDifficulty(song, difficulty);
    if (diff?.artist) return diff.artist;
  }
  return song.artist;
}

export function formatDifficultyLevel(diff: Pick<CatalogDifficulty, "rating" | "ratingPlus">): string {
  return `${diff.rating}${diff.ratingPlus ? "+" : ""}`;
}

export function searchCatalogSongs(
  query: string,
  options: { limit?: number; prioritizeSongIds?: ReadonlySet<string> } = {},
): CatalogSong[] {
  const limit = options.limit ?? 30;
  const prioritize = options.prioritizeSongIds;
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [...indexedCatalog]
      .sort((a, b) => {
        const aFav = prioritize?.has(a.song.id) ? 1 : 0;
        const bFav = prioritize?.has(b.song.id) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        if (a.maxConstant !== b.maxConstant) return b.maxConstant - a.maxConstant;
        return a.titleLower.localeCompare(b.titleLower);
      })
      .slice(0, limit)
      .map((entry) => entry.song);
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: IndexedSong; rank: number; fav: number }> = [];

  for (const entry of indexedCatalog) {
    if (!tokens.every((token) => entry.combinedLower.includes(token))) continue;

    let rank = 5;
    if (
      entry.idLower === normalized ||
      entry.titleLower === normalized ||
      entry.jaLower === normalized ||
      entry.extraTitlesLower.some((value) => value === normalized) ||
      entry.searchLower.some((value) => value === normalized)
    ) {
      rank = 0;
    } else if (
      entry.titleLower.startsWith(normalized) ||
      entry.idLower.startsWith(normalized) ||
      entry.jaLower.startsWith(normalized) ||
      entry.extraTitlesLower.some((value) => value.startsWith(normalized))
    ) {
      rank = 1;
    } else if (
      entry.titleLower.includes(normalized) ||
      entry.jaLower.includes(normalized) ||
      entry.extraTitlesLower.some((value) => value.includes(normalized))
    ) {
      rank = 2;
    } else if (entry.idLower.includes(normalized) || entry.searchLower.some((value) => value.includes(normalized))) {
      rank = 3;
    } else if (entry.artistLower.includes(normalized)) {
      rank = 4;
    }

    scored.push({
      entry,
      rank,
      fav: prioritize?.has(entry.song.id) ? 1 : 0,
    });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.fav !== b.fav) return b.fav - a.fav;
    if (a.entry.maxConstant !== b.entry.maxConstant) return a.entry.maxConstant - b.entry.maxConstant;
    return a.entry.titleLower.localeCompare(b.entry.titleLower);
  });

  return scored.slice(0, limit).map((item) => item.entry.song);
}
