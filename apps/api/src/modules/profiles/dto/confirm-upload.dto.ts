import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({ description: 'S3 object key returned from presigned URL step' })
  @IsString()
  @IsNotEmpty()
  key: string;
}
