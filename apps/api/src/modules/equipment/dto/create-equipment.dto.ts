import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEquipmentDto {
  @ApiProperty({ example: 'ARRI Alexa Mini LF' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'URL or storage key for equipment image' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  currentCity?: string;

  @ApiPropertyOptional({ description: 'Daily rate min in paise' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  dailyRateMin?: number;

  @ApiPropertyOptional({ description: 'Daily rate max in paise' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  dailyRateMax?: number;
}
