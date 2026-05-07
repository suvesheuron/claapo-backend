/**
 * One-shot: write a fresh CORS config to the S3 bucket so the deployed frontend
 * origins (Vercel prod + previews + localhost) can PUT/GET via presigned URLs.
 *
 * Run:
 *   npx ts-node scripts/update-s3-cors.ts
 *
 * Reads AWS_REGION / AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 * from .env at the backend root.
 */
import 'dotenv/config';
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION;
const bucket = process.env.AWS_S3_BUCKET;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!region || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error(
    'Missing one of AWS_REGION / AWS_S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env',
  );
}

const ALLOWED_ORIGINS = [
  // Local dev
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',

  // Production frontend (Vercel)
  'https://claapo-frontend.vercel.app',

  // Vercel preview deployments — wildcard subdomain. S3 supports a single `*`
  // wildcard per origin entry and matches the whole label, which covers the
  // `claapo-frontend-<hash>-<scope>.vercel.app` pattern.
  'https://*.vercel.app',
];

const client = new S3Client({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  console.log(`→ Updating CORS on bucket "${bucket}" in ${region}`);

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedMethods: ['GET', 'PUT', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    }),
  );

  console.log('✓ PutBucketCors OK\n');

  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log('Current CORS rules:');
  console.dir(current.CORSRules, { depth: null });
}

main().catch((err) => {
  console.error('✗ Failed:', err);
  process.exit(1);
});
