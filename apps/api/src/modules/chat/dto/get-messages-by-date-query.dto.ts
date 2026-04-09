import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesByDateQueryDto {
  @ApiPropertyOptional({ description: 'Date in YYYY-MM-DD format (legacy, use start/end instead)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Start datetime in ISO format (e.g., 2026-04-01T00:00:00.000Z)' })
  @IsOptional()
  @IsString()
  start?: string;

  @ApiPropertyOptional({ description: 'End datetime in ISO format (e.g., 2026-04-02T00:00:00.000Z)' })
  @IsOptional()
  @IsString()
  end?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ description: 'Limit per page (default: 50, max: 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
