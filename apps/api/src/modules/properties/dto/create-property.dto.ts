import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Sea-facing Heritage Villa' })
  @IsString()
  name: string;

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

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Latitude for the Google map pin' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  addressLat?: number;

  @ApiPropertyOptional({ description: 'Longitude for the Google map pin' })
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

  @ApiPropertyOptional({ type: [String], description: 'Storage keys of uploaded photos (from upload-url step)' })
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
