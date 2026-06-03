import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreatePropertyAvailabilityDto {
  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  locationCity: string;

  @ApiProperty({ example: '2026-07-10' })
  @IsDateString()
  availableFrom: string;

  @ApiProperty({ example: '2026-07-15' })
  @IsDateString()
  availableTo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
