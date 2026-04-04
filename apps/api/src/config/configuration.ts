export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  /** When true, OTP responses include `devOtp` (use only without real SMS; never in real production). */
  exposeOtpInApi: process.env.EXPOSE_OTP_IN_API === 'true',
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,*').split(',').map((s) => s.trim()),
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  aws: {
    region: process.env.AWS_REGION ?? 'ap-south-1',
    s3Bucket: process.env.AWS_S3_BUCKET ?? '',
    cloudFrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN ?? '',
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'uploads',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
});
