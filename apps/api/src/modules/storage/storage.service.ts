import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PRESIGNED_PUT_EXPIRY = 3600; // 1 hour
const PRESIGNED_GET_EXPIRY = 3600;

@Injectable()
export class StorageService {
  private readonly s3: S3Client | null = null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly cloudFrontDomain: string | undefined;

  private readonly supabase: SupabaseClient | null = null;
  private readonly supabaseBucket: string;
  private readonly apiBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('aws.s3Bucket') ?? '';
    this.region = this.config.get<string>('aws.region') ?? 'ap-south-1';
    this.cloudFrontDomain = this.config.get<string>('aws.cloudFrontDomain');
    this.apiBaseUrl = this.config.get<string>('apiBaseUrl') ?? 'http://localhost:3000';
    this.supabaseBucket = this.config.get<string>('supabase.storageBucket') ?? 'uploads';

    if (this.bucket && (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE)) {
      this.s3 = new S3Client({
        region: this.region,
        ...(process.env.AWS_ENDPOINT && { endpoint: process.env.AWS_ENDPOINT }),
      });
    }

    const supabaseUrl = this.config.get<string>('supabase.url');
    const supabaseKey = this.config.get<string>('supabase.serviceRoleKey');
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  /** Prefer Supabase when configured, else S3, else local. */
  isSupabaseConfigured(): boolean {
    return !!this.supabase && !!this.config.get<string>('supabase.url');
  }

  private get client(): S3Client {
    if (!this.s3) {
      throw new Error('S3 is not configured. Set AWS_S3_BUCKET and AWS credentials.');
    }
    return this.s3;
  }

  async getPresignedPutUrl(key: string, contentType?: string): Promise<{ uploadUrl: string; key: string }> {
    if (this.isSupabaseConfigured()) {
      // Client will PUT to our backend; we forward to Supabase
      const base = this.apiBaseUrl.replace(/\/$/, '');
      const uploadUrl = `${base}/v1/storage/upload?key=${encodeURIComponent(key)}`;
      return { uploadUrl, key };
    }
    if (!this.isConfigured()) {
      const uploadUrl = `${this.apiBaseUrl}/v1/storage/upload?key=${encodeURIComponent(key)}`;
      return { uploadUrl, key };
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(contentType && { ContentType: contentType }),
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: PRESIGNED_PUT_EXPIRY });
    return { uploadUrl, key };
  }

  /** Upload a buffer to Supabase Storage (used by upload controller when Supabase is configured). */
  async uploadBufferToSupabase(key: string, buffer: Buffer, contentType?: string): Promise<void> {
    if (!this.supabase) throw new Error('Supabase storage is not configured.');
    const { error } = await this.supabase.storage
      .from(this.supabaseBucket)
      .upload(key, buffer, { upsert: true, contentType: contentType ?? 'application/octet-stream' });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  }

  async getPresignedGetUrl(key: string): Promise<string> {
    if (this.isSupabaseConfigured() && this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.supabaseBucket)
        .createSignedUrl(key, PRESIGNED_GET_EXPIRY);
      if (error) throw new Error(`Supabase signed URL failed: ${error.message}`);
      return data?.signedUrl ?? '';
    }
    if (!this.isConfigured()) {
      return `${this.apiBaseUrl}/v1/storage/files/${key}`;
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_GET_EXPIRY });
  }

  /** Public URL via CloudFront, Supabase public URL, local fallback, or null. */
  getPublicUrl(key: string | null): string | null {
    if (!key) return null;
    if (key.startsWith('http://') || key.startsWith('https://')) return key;
    if (this.isSupabaseConfigured() && this.supabase) {
      const { data } = this.supabase.storage.from(this.supabaseBucket).getPublicUrl(key);
      return data?.publicUrl ?? null;
    }
    if (!this.isConfigured() || !this.cloudFrontDomain) {
      return `${this.apiBaseUrl}/v1/storage/files/${key}`;
    }
    return `https://${this.cloudFrontDomain}/${key}`;
  }

  /** Presigned GET URL for private assets; local fallback if neither Supabase nor S3 configured. */
  async getSignedUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    if (key.startsWith('http://') || key.startsWith('https://')) return key;
    if (this.isSupabaseConfigured() && this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.supabaseBucket)
        .createSignedUrl(key, PRESIGNED_GET_EXPIRY);
      if (error) return null;
      return data?.signedUrl ?? null;
    }
    if (!this.s3) return `${this.apiBaseUrl}/v1/storage/files/${key}`;
    return this.getPresignedGetUrl(key);
  }

  async deleteObject(key: string): Promise<void> {
    if (this.isSupabaseConfigured() && this.supabase) {
      await this.supabase.storage.from(this.supabaseBucket).remove([key]);
      return;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  isConfigured(): boolean {
    return !!this.s3 && !!this.bucket;
  }
}
