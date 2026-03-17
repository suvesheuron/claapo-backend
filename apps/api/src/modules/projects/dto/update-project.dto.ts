import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, IsDateString, IsEnum, IsArray } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productionHouseName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({ type: [String], description: 'Specific shoot dates (ISO date strings)' })
  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  shootDates?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shootLocations?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional({ enum: ['draft', 'open', 'active', 'completed', 'cancelled'] })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
