import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, Min } from 'class-validator';

export class AddInvoiceAttachmentDto {
  @ApiProperty({ description: 'S3 key after upload via presigned URL' })
  @IsString()
  fileKey: string;

  @ApiProperty()
  @IsString()
  fileName: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes' })
  @IsInt()
  @Min(0)
  size: number;
}
