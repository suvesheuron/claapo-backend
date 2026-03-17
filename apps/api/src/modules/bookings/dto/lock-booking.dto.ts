import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsArray, IsDateString, IsString } from 'class-validator';

export class LockBookingDto {
  @ApiPropertyOptional({ type: [String], description: 'Specific shoot dates (ISO) for this booking; defaults to project shootDates' })
  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  shootDates?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Shoot locations for this booking; defaults to project shootLocations' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shootLocations?: string[];
}
