import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateEquipmentAvailabilityDto {
  @ApiProperty({ example: 'Ladakh' })
  @IsString()
  locationCity: string;

  @ApiProperty({ example: '2026-03-10' })
  @IsDateString()
  availableFrom: string;

  @ApiProperty({ example: '2026-03-15' })
  @IsDateString()
  availableTo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
