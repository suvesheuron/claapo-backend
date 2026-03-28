import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, IsDateString, IsArray } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Midnight Chronicles' })
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Yash Raj Films' })
  @IsOptional()
  @IsString()
  productionHouseName?: string;

  @ApiProperty({ example: '2024-12-15' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2024-12-22' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: '2024-12-30' })
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({ type: [String], example: ['2024-12-15', '2024-12-18', '2024-12-22'] })
  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  shootDates?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Mumbai', 'Lonavala'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shootLocations?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional({ description: 'Budget in paise' })
  @IsOptional()
  @IsInt()
  @Min(0)
  budget?: number;
}
