import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, Length } from 'class-validator';

export class PasswordResetEmailRequestDto {
  @ApiProperty({ example: 'user@claapo.com' })
  @IsEmail()
  email: string;
}

export class PasswordResetEmailConfirmDto {
  @ApiProperty({ example: 'user@claapo.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
