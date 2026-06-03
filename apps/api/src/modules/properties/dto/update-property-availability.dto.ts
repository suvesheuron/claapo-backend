import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdatePropertyAvailabilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  availableFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  availableTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
