import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class OtpEmailSendDto {
  @ApiProperty({ example: 'user@claapo.com' })
  @IsEmail()
  email: string;
}
