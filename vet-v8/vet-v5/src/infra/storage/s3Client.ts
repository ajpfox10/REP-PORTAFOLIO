import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type AppConfig } from "../../config/types.js";
import { AppError } from "../../core/errors/appError.js";

export function buildS3(config: AppConfig) {
  if (!config.s3Bucket) {
    throw new AppError("CONFIG_ERROR", "S3_BUCKET is required when file storage is enabled");
  }
  return new S3Client({ region: config.s3Region });
}

export async function presignPutObject(opts: {
  s3: S3Client;
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) {
  const cmd = new PutObjectCommand({ Bucket: opts.bucket, Key: opts.key, ContentType: opts.contentType });
  return getSignedUrl(opts.s3, cmd, { expiresIn: opts.expiresInSeconds ?? 60 });
}
