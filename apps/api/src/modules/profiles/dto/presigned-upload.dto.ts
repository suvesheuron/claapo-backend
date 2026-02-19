import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';

export class PresignedUploadDto {
  @ApiPropertyOptional({ description: 'MIME type for upload', example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
  contentType?: string;
}
