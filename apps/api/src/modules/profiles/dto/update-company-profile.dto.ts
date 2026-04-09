import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

const normalizeUrl = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
};

export class UpdateCompanyProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  panNumber?: string;

  @ApiPropertyOptional({ example: 'ad_agency' })
  @IsOptional()
  @IsString()
  companyType?: string;

  @ApiPropertyOptional({ example: ['Camera', 'Lighting'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'About Us section (longer text)' })
  @IsOptional()
  @IsString()
  aboutUs?: string;
}
