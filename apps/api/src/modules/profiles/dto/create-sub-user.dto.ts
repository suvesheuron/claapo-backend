import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, Matches, IsOptional } from 'class-validator';

export class CreateSubUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Display name for the sub-user (shown in chat, project details, etc.)' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ example: '+919900112233' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
