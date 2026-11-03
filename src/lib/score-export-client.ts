import type { Best50Score, ScoreExportProfile, SongScore } from "./types";

let profileRequest: Promise<ScoreExportProfile> | undefined;
let renderer: Promise<typeof import("./score-result-renderer")> | undefined;

function loadScoreExportProfile() {
  // Deduplicate simultaneous exports, while refreshing the user on every new one.
  if (!profileRequest) {
    profileRequest = (async () => {
      const response = await fetch("/api/score-export/profile", { cache: "no-store", signal: AbortSignal.timeout(45_000) });
      const payload = await response.json() as Partial<ScoreExportProfile> & { error?: string };
      if (!response.ok) throw new Error(payload.error || "用户信息加载失败，请重试导出。");
      if (!payload.user?.name || !payload.characterAssetId) throw new Error("用户信息不完整，请重试导出。");
      return payload as ScoreExportProfile;
    })().finally(() => { profileRequest = undefined; });
  }
  return profileRequest;
}

function loadRenderer() {
  if (!renderer) {
    renderer = import("./score-result-renderer").then(module => {
      void module.preloadScoreResultAssets().catch(() => {});
      return module;
    }).catch(error => { renderer = undefined; throw error; });
  }
  return renderer;
}

export function prepareScoreResult() {
  // Hover/focus only warms public game assets; it never contacts Lowiro.
  void loadRenderer().then(module => module.preloadScoreResultAssets()).catch(() => {});
}

export async function exportScoreResult(score: Best50Score | SongScore) {
  const profile = loadScoreExportProfile();
  // Decode the chart/UI while the fresh profile is still in flight. Attaching
  // both promises immediately also handles profile failures during chunk loading.
  await Promise.all([
    loadRenderer().then(module => module.downloadScoreResult(score, profile)),
    profile,
  ]);
}
