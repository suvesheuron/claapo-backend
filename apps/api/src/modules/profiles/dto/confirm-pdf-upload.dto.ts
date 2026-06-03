import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ConfirmPdfUploadDto {
  @ApiProperty({ description: 'Storage object key returned from the presigned URL step' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiPropertyOptional({ description: 'Original file name (for display/download)' })
  @IsOptional()
  @IsString()
  fileName?: string;
}
