import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateEquipmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'URL or storage key for equipment image' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentCity?: string;

  @ApiPropertyOptional({ description: 'Daily budget in paise' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  dailyBudget?: number;
}
