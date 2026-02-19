import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class FcmTokenDto {
  @ApiProperty({ description: 'Firebase Cloud Messaging device token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
