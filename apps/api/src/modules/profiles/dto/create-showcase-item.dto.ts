import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn, MaxLength } from 'class-validator';

/**
 * Confirm a finished upload and register it as a Work Showcase item.
 * `key` is the object key returned from the upload-url step; the service
 * validates it belongs to the caller before persisting.
 */
export class CreateShowcaseItemDto {
  @ApiProperty({ description: 'Storage object key returned from the upload-url step' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ enum: ['image', 'video', 'document'] })
  @IsString()
  @IsIn(['image', 'video', 'document'])
  mediaType: 'image' | 'video' | 'document';

  @ApiPropertyOptional({ description: 'Display title for the item' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ description: 'Original file name (shown for documents)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ description: 'MIME type of the uploaded file' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}
