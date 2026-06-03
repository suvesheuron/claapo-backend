import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const PROPERTY_UPLOAD_KINDS = ['photo', 'pdf'] as const;
export type PropertyUploadKind = (typeof PROPERTY_UPLOAD_KINDS)[number];

export class PropertyUploadUrlDto {
  @ApiProperty({ enum: PROPERTY_UPLOAD_KINDS })
  @IsIn(PROPERTY_UPLOAD_KINDS as unknown as string[])
  kind: PropertyUploadKind;

  @ApiPropertyOptional({ description: 'MIME type the client will PUT (must match the upload).' })
  @IsOptional()
  @IsString()
  contentType?: string;
}
