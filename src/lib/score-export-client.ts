import type { Best50Score, ScoreExportHint, ScoreExportProfile, SongScore } from "./types";

export const PLAYER_PROFILE_UPDATED_EVENT = "arconline:player-profile-updated";

let profileRequest: Promise<ScoreExportProfile> | undefined;
let renderer: Promise<typeof import("./score-result-renderer")> | undefined;
let profileHint: ScoreExportHint | undefined;

export function setScoreExportHint(hint: ScoreExportHint | null | undefined) { profileHint = hint ?? undefined; }

function loadScoreExportProfile() {
  // Concurrent exports share one refresh. Workers reuses the saved Lowiro
  // session and refreshes only the user, avatar and banner needed by the image.
  if (!profileRequest) {
    profileRequest = (async () => {
      const response = await fetch("/api/score-export/profile", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(90_000) });
      const payload = await response.json() as Partial<ScoreExportProfile> & { error?: string };
      if (!response.ok) throw new Error(payload.error || "用户信息加载失败，请重试导出。");
      if (!payload.user?.name || !payload.characterAssetId) throw new Error("用户信息不完整，请重试导出。");
      setScoreExportHint(payload.user);
      window.dispatchEvent(new CustomEvent(PLAYER_PROFILE_UPDATED_EVENT, { detail: payload.user }));
      return payload as ScoreExportProfile;
    })().finally(() => { profileRequest = undefined; });
  }
  return profileRequest;
}

function loadRenderer() {
  if (!renderer) {
    renderer = import("./score-result-renderer").then(module => {
      void module.preloadScoreResultAssets(profileHint).catch(() => {});
      return module;
    }).catch(error => { renderer = undefined; throw error; });
  }
  return renderer;
}

export function prepareScoreResult() {
  // Hover/focus warms game assets and already-synced images, without Lowiro.
  void loadRenderer().then(module => module.preloadScoreResultAssets(profileHint)).catch(() => {});
}

export async function exportScoreResult(score: Best50Score | SongScore) {
  const profile = loadScoreExportProfile();
  // Decode the chart/UI while the user profile is still in flight. Attaching
  // both promises immediately also handles profile failures during chunk loading.
  await Promise.all([
    loadRenderer().then(module => module.downloadScoreResult(score, profile)),
    profile,
  ]);
}
