import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsUrl } from 'class-validator';
import { VendorType } from '@prisma/client';

export class UpdateVendorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ enum: ['all', 'equipment', 'lighting', 'transport', 'catering'] })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;

  @ApiPropertyOptional({ description: 'Human-readable category from onboarding (Camera, Lights, …)' })
  @IsOptional()
  @IsString()
  vendorServiceCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  linkedinUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  twitterUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  youtubeUrl?: string;

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
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ description: 'About Us section (longer text)' })
  @IsOptional()
  @IsString()
  aboutUs?: string;
}
