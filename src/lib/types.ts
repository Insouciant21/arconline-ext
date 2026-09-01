export interface LocalizedTitle {
  en?: string;
  ja?: string;
  zh?: string;
  [key: string]: string | undefined;
}

export interface Best50Score {
  songId: string;
  difficulty: number;
  modifier: number;
  rating: number;
  score: number;
  perfectCount: number;
  nearCount: number;
  missCount: number;
  clearType: number;
  title: LocalizedTitle;
  artist: string;
  timePlayed: number;
  bg?: string;
  imageKey?: string;
  imageUrl?: string;
}

export interface StoredUser {
  rating: number;
  name?: string;
  userCode?: string;
  country?: string;
  characterId?: number;
  characterIcon?: string;
  avatarImageKey?: string;
  avatarImageUrl?: string;
}

export interface ImageStats {
  requested: number;
  uploaded: number;
  failed: number;
  failures: Array<{ songId: string; reason: string }>;
  cached?: number;
}

export type MediaStatus = "processing" | "complete" | "failed";

export interface ChartImageCacheEntry {
  songId: string;
  bg?: string;
  imageKey?: string;
  imageUrl?: string;
  updatedAt: string;
}

export type ChartImageCache = Record<string, ChartImageCacheEntry>;

export interface CharacterImageCacheEntry {
  characterId: number;
  icon?: string;
  imageKey?: string;
  imageUrl?: string;
  updatedAt: string;
}

export type CharacterImageCache = Record<string, CharacterImageCacheEntry>;

export interface B50Snapshot {
  id: string;
  fetchedAt: string;
  trigger: "manual" | "daily" | "cron";
  potential: number;
  weightedPotential: number;
  user: StoredUser;
  best50: Best50Score[];
  potentialImageKey?: string;
  potentialImageUrl?: string;
  imageStats: ImageStats;
  mediaStatus?: MediaStatus;
  mediaError?: string;
}

export interface PotentialHistoryPoint {
  date: string;
  potential: number;
  snapshotId: string;
  fetchedAt: string;
}

export interface DashboardPayload {
  latest: B50Snapshot | null;
  history: PotentialHistoryPoint[];
  scheduler: {
    timezone: string;
    cron: string;
  };
}

export interface SyncResult {
  snapshot: B50Snapshot;
  message: string;
}
