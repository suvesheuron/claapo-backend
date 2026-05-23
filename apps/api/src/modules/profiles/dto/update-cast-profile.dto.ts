import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CAST_GENDERS, CAST_ROLE_TYPES } from '../../auth/dto/register-cast.dto';

const normalizeUrl = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
};

export class UpdateCastProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ enum: CAST_ROLE_TYPES })
  @IsOptional()
  @IsIn(CAST_ROLE_TYPES as unknown as string[])
  roleType?: 'actor' | 'model';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: CAST_GENDERS })
  @IsOptional()
  @IsIn(CAST_GENDERS as unknown as string[])
  gender?: 'male' | 'female' | 'other';

  // Personal details
  @ApiPropertyOptional({ description: 'Height in centimetres' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(260)
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skinTone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eyeColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lookType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hairType?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  languages?: string[];

  // Professional
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aboutMe?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ type: [String], description: 'Free-form skill tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(40)
  extraSkills?: string[];

  @ApiPropertyOptional({ description: 'Daily budget in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyBudget?: number;

  // Location
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationState?: string;

  // Social links
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  imdbUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  youtubeUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  vimeoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isAvailable?: boolean;

  // Billing / banking
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  panNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sacCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;
}
