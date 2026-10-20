import type { Env } from "./environment";
import type { B50Snapshot } from "./types";

export function publicAssetUrl(env: Env, key: string) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return env.R2_PUBLIC_URL?.trim() ? `${env.R2_PUBLIC_URL.trim().replace(/\/$/, "")}/${encoded}` : `/api/media/${encoded}`;
}
export async function putAsset(env: Env, key: string, body: ArrayBuffer | string, contentType: string, metadata: Record<string, string> = {}) {
  await env.ARCHIVE.put(key, body, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: metadata,
  });
  return { key };
}
export async function putSnapshot(env: Env, snapshot: B50Snapshot) {
  await env.ARCHIVE.put(`snapshots/${snapshot.id}.json`, JSON.stringify(snapshot, null, 2) + "\n", {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-cache" },
    customMetadata: { kind: "b50-snapshot", snapshotId: snapshot.id, fetchedAt: snapshot.fetchedAt },
  });
}
