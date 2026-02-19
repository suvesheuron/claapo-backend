import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, IsDateString } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Midnight Chronicles' })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2024-12-15' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2024-12-22' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional({ description: 'Budget min in INR' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ description: 'Budget max in INR' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetMax?: number;
}
