export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  trustProxy: number;

  masterDb: { host: string; port: number; user: string; password: string; name: string };
  tenantDb: { host: string; port: number; user: string; password: string };

  redisUrl: string;

  schemaCacheTtlSeconds: number;
  tenantConnCacheTtlSeconds: number;

  crudStrictAllowlist: boolean;
  crudTableAllowlist: string[];
  crudTableDenylist: string[];

  openApiOutput: string;

  stripeSecretKey: string;
  stripeWebhookSecret: string;

  /**
   * Auth keys
   * - In production prefer RS256 via JOSE + JWKS.
   * - HS256 secrets remain supported for local/dev fallback.
   */
  jwtSecret: string;
  jwtRefreshSecret: string;
  jwtAlgorithm: "HS256" | "RS256";
  jwtKeyId: string;
  jwtPrivateKeyPem: string;
  jwksPublicKeysJson: string;

  /** Observability */
  metricsEnable: boolean;
  metricsProtect: boolean;

  /** Storage (S3) */
  s3Region: string;
  s3Bucket: string;

  /** Notifications */
  sesFromEmail: string;
  snsRegion: string;
  snsSenderId: string;

  /** Field-level encryption */
  kmsKeyId: string;
  encryptionMasterSecret: string;

  internalApiIpAllowlist: string[];
  internalApiSharedSecret: string;

  featureFlags: Record<string, boolean>;
};
