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

  @ApiPropertyOptional({ description: 'Daily rate in INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyRateMin?: number;

  @ApiPropertyOptional({ description: 'Daily rate in INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyRateMax?: number;

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
  @Type(() => Boolean)
  @IsBoolean()
  isAvailable?: boolean;
}
