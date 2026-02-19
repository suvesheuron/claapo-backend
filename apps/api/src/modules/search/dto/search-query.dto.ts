import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { VendorType } from '@prisma/client';

export class SearchCrewQueryDto {
  @ApiPropertyOptional({ description: 'Skill or role, e.g. DOP or comma-separated' })
  @IsOptional()
  @IsString()
  skill?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '2024-12-15' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-22' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Daily rate min INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Daily rate max INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMax?: number;

  @ApiPropertyOptional({ description: 'Only show available (isAvailable=true)' })
  @IsOptional()
  @Type(() => Boolean)
  availableOnly?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class SearchVendorsQueryDto {
  @ApiPropertyOptional({ enum: ['equipment', 'lighting', 'transport', 'catering'] })
  @IsOptional()
  @IsEnum(VendorType)
  type?: VendorType;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
