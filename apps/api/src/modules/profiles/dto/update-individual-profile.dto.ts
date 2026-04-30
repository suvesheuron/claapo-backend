import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsInt, IsBoolean, Min, Max, ArrayMaxSize } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Lenient URL transform: trims, returns undefined for empty,
 * auto-prefixes https:// if scheme is missing. Stored as plain string
 * so the field survives even if the user pastes a partial URL.
 */
const normalizeUrl = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
};

export class UpdateIndividualProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'About Me section (longer text)' })
  @IsOptional()
  @IsString()
  aboutMe?: string;

  @ApiPropertyOptional({ example: ['DOP', 'Director'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ example: ['Drama', 'Comedy'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  genres?: string[];

  @ApiPropertyOptional({ description: 'Mailing / invoice address' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ description: 'Daily budget in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyBudget?: number;

  @ApiPropertyOptional({ description: 'Personal or portfolio website URL' })
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
  @Transform(normalizeUrl)
  @IsString()
  linkedinUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  twitterUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: 'PAN number (for invoice details)' })
  @IsOptional()
  @IsString()
  panNumber?: string;

  @ApiPropertyOptional({ description: 'Billing name shown in invoice From section' })
  @IsOptional()
  @IsString()
  billingName?: string;

  @ApiPropertyOptional({ description: 'GST number (optional, shown on invoices)' })
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional({ description: 'SAC code (required when GST is provided)' })
  @IsOptional()
  @IsString()
  sacCode?: string;

  @ApiPropertyOptional({ description: 'UPI ID (for payment on invoices)' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({ description: 'Bank account name (for invoice details)' })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional({ description: 'Bank account number (for invoice details)' })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: 'IFSC code (for invoice details)' })
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional({ description: 'Bank name (for invoice details)' })
  @IsOptional()
  @IsString()
  bankName?: string;
}
