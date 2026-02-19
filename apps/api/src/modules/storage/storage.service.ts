import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_PUT_EXPIRY = 3600; // 1 hour
const PRESIGNED_GET_EXPIRY = 3600;

@Injectable()
export class StorageService {
  private readonly s3: S3Client | null = null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly cloudFrontDomain: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('aws.s3Bucket') ?? '';
    this.region = this.config.get<string>('aws.region') ?? 'ap-south-1';
    this.cloudFrontDomain = this.config.get<string>('aws.cloudFrontDomain');
    if (this.bucket && (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE)) {
      this.s3 = new S3Client({
        region: this.region,
        ...(process.env.AWS_ENDPOINT && { endpoint: process.env.AWS_ENDPOINT }),
      });
    }
  }

  private get client(): S3Client {
    if (!this.s3) {
      throw new Error('S3 is not configured. Set AWS_S3_BUCKET and AWS credentials.');
    }
    return this.s3;
  }

  async getPresignedPutUrl(key: string, contentType?: string): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(contentType && { ContentType: contentType }),
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: PRESIGNED_PUT_EXPIRY });
    return { uploadUrl, key };
  }

  async getPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_GET_EXPIRY });
  }

  /** Public URL via CloudFront, or null if not configured. */
  getPublicUrl(key: string | null): string | null {
    if (!key || !this.cloudFrontDomain) return null;
    return `https://${this.cloudFrontDomain}/${key}`;
  }

  /** Presigned GET URL for private assets; returns null if S3 not configured. */
  async getSignedUrl(key: string | null): Promise<string | null> {
    if (!key || !this.s3) return null;
    return this.getPresignedGetUrl(key);
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  isConfigured(): boolean {
    return !!this.s3 && !!this.bucket;
  }
}
