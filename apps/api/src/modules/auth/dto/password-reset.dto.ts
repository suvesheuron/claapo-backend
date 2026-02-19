import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, Matches, Length } from 'class-validator';

export class PasswordResetRequestDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[1-9]\d{10,14}$/)
  phone: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[1-9]\d{10,14}$/)
  phone: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
