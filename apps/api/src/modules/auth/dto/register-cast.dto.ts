import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CAST_ROLE_TYPES = ['actor', 'model'] as const;
export type CastRoleType = (typeof CAST_ROLE_TYPES)[number];

export const CAST_GENDERS = ['male', 'female', 'other'] as const;
export type CastGender = (typeof CAST_GENDERS)[number];

export class RegisterCastDto {
  @ApiProperty({ example: 'actor@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[1-9]\d{10,14}$/, { message: 'Invalid phone number' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty({ example: 'Riya Sharma' })
  @IsString()
  @MinLength(2)
  displayName: string;

  @ApiProperty({ enum: CAST_ROLE_TYPES })
  @IsIn(CAST_ROLE_TYPES as unknown as string[])
  roleType: CastRoleType;

  @ApiPropertyOptional({ minimum: 1, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: CAST_GENDERS })
  @IsOptional()
  @IsIn(CAST_GENDERS as unknown as string[])
  gender?: CastGender;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  locationCity?: string;
}
