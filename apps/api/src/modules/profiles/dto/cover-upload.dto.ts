import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';

/**
 * Cover/banner upload — unlike the avatar (image only), a cover may be an
 * image OR a short motion banner (video). The service maps the MIME to the
 * stored extension and the resolved coverType, so clients know whether to
 * render an <img> or a <video>.
 */
export class CoverUploadDto {
  @ApiPropertyOptional({
    description: 'MIME type for the cover upload (image or video)',
    example: 'video/mp4',
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
  ])
  contentType?: string;
}
