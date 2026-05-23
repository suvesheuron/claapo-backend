import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsUUID, Min, IsDateString, IsArray } from 'class-validator';

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

  /**
   * Casting Director flow only. When set, invoices for bookings under this
   * project route to this company instead of the project owner. Must be the
   * userId of a company that has hired the casting director (an accepted or
   * locked booking with this user as target). Set null/undefined for normal
   * projects.
   */
  @ApiPropertyOptional({
    description:
      'UUID of the company that should ultimately be billed for invoices in this project (Casting Director flow).',
  })
  @IsOptional()
  @IsUUID()
  billedToCompanyUserId?: string;
}
