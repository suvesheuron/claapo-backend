import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePropertyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  subTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  addressLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  addressLng?: number;

  @ApiPropertyOptional({ description: 'Daily rental price in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyBudget?: number;

  @ApiPropertyOptional({ type: [String], description: 'Full replacement set of photo storage keys' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  photoKeys?: string[];

  @ApiPropertyOptional({ description: 'Storage key of the uploaded property PDF' })
  @IsOptional()
  @IsString()
  pdfKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pdfName?: string;
}
