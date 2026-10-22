import { ArcaeaClient } from "./arcaea-client";
import type { Env } from "./environment";
import { publicAssetUrl, putAsset } from "./r2";
import { parseSongScoreQuery } from "./song-query";
import type { SongScoresPayload } from "./types";

export async function getSongScores(env: Env, params: URLSearchParams): Promise<SongScoresPayload> {
  const query = parseSongScoreQuery(params);
  const client = await ArcaeaClient.login(env);
  const result = await client.getSongScores(query);
  const images = new Map<string, string>();
  const backgrounds = [...new Set(result.scores.map(score => score.bg).filter((bg): bg is string => Boolean(bg && /^[a-f0-9]{32}$/i.test(bg))))];
  // Reuse B50 artwork; fetch missing covers in pairs with the same Lowiro session.
  for (let index = 0; index < backgrounds.length; index += 2) {
    await Promise.all(backgrounds.slice(index, index + 2).map(async bg => {
      const key = `charts/${bg}.jpg`;
      try {
        if (!await env.ARCHIVE.head(key)) {
          const image = await client.getChartImage(bg);
          await putAsset(env, key, image.body, image.contentType, { kind: "chart" });
        }
        images.set(bg, key);
      } catch {
        // Artwork failure must not hide a successfully retrieved score.
        console.warn("Song artwork could not be cached.");
      }
    }));
  }
  return {
    ...result,
    scores: result.scores.map(score => {
      const imageKey = score.bg ? images.get(score.bg) : undefined;
      return { ...score, ...(imageKey ? { imageKey, imageUrl: publicAssetUrl(env, imageKey) } : {}) };
    }),
  };
}
