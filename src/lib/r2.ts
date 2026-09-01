import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config, requireR2 } from "./config";
import { AppError } from "./errors";
import type { B50Snapshot } from "./types";

let client: S3Client | undefined;

function getClient() {
  requireR2();
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint:
        config.r2Endpoint || `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId!,
        secretAccessKey: config.r2SecretAccessKey!,
      },
    });
  }
  return client;
}

export function publicAssetUrl(key: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return config.r2PublicUrl ? `${config.r2PublicUrl}/${encodedKey}` : `/api/media/${encodedKey}`;
}

export async function putAsset(
  key: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
) {
  const response = await getClient().send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
      Metadata: metadata,
    }),
  );
  return { key, etag: response.ETag || undefined };
}

export async function putSnapshot(snapshot: B50Snapshot) {
  const key = `snapshots/${snapshot.id}.json`;
  const body = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  try {
    const response = await getClient().send(
      new PutObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-cache",
        Metadata: {
          kind: "b50-snapshot",
          snapshotId: snapshot.id,
          fetchedAt: snapshot.fetchedAt,
          trigger: snapshot.trigger,
        },
      }),
    );
    return { key, etag: response.ETag || undefined };
  } catch (error) {
    console.error(`[r2] failed to back up B50 snapshot ${snapshot.id}`, error);
    throw new AppError(
      "B50 快照备份到 R2 失败，请检查 R2 配置或网络。",
      502,
      "R2_SNAPSHOT_BACKUP_FAILED",
    );
  }
}

export async function headAsset(key: string) {
  try {
    return await getClient().send(
      new HeadObjectCommand({ Bucket: config.r2BucketName, Key: key }),
    );
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export async function getAsset(key: string) {
  const output = await getClient().send(
    new GetObjectCommand({ Bucket: config.r2BucketName, Key: key }),
  );
  if (!output.Body) {
    throw new AppError("R2 对象没有内容。", 502, "R2_EMPTY_OBJECT");
  }
  const bytes = await output.Body.transformToByteArray();
  return {
    body: Buffer.from(bytes),
    contentType: output.ContentType || "application/octet-stream",
    etag: output.ETag,
    cacheControl: output.CacheControl,
  };
}
