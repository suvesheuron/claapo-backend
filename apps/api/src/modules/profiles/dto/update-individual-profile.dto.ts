import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsInt, IsBoolean, IsUrl, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

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

  @ApiPropertyOptional({ example: 'Action' })
  @IsOptional()
  @IsString()
  genre?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imdbUrl?: string;

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
  @Type(() => Boolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: 'PAN number (for invoice details)' })
  @IsOptional()
  @IsString()
  panNumber?: string;

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
