import { Controller, Put, Get, Query, Req, Res, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { StorageService } from './storage.service';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
  }

  @Put('upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload file to local storage or Supabase (when configured)' })
  async upload(@Query('key') key: string, @Req() req: Request, @Res() res: Response) {
    if (!key) {
      return res.status(400).json({ message: 'Missing "key" query parameter' });
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;

        if (this.storage.isSupabaseConfigured()) {
          await this.storage.uploadBufferToSupabase(key, buffer, contentType);
          return res.json({ message: 'File uploaded successfully', key });
        }

        const filePath = path.join(UPLOADS_DIR, key);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, buffer);
        return res.json({ message: 'File uploaded successfully', key });
      } catch (err: any) {
        return res.status(500).json({ message: 'Upload failed', error: err?.message ?? 'Unknown error' });
      }
    });
    req.on('error', (err) => {
      res.status(500).json({ message: 'Upload failed', error: err.message });
    });
  }

  @Get('files/*')
  @ApiOperation({ summary: 'Serve a file from local storage or redirect to Supabase signed URL' })
  async serve(@Req() req: Request, @Res() res: Response) {
    const prefix = '/v1/storage/files/';
    let key = req.path;
    if (key.startsWith(prefix)) {
      key = key.slice(prefix.length);
    } else {
      const idx = key.indexOf('/files/');
      key = idx >= 0 ? key.slice(idx + 7) : key;
    }

    if (this.storage.isSupabaseConfigured()) {
      const signedUrl = await this.storage.getSignedUrl(key);
      if (signedUrl) return res.redirect(302, signedUrl);
      return res.status(404).json({ message: 'File not found' });
    }

    const filePath = path.join(UPLOADS_DIR, key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }
    return res.sendFile(filePath);
  }
}
