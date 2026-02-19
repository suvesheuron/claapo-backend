import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, IsDateString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SlotStatus } from '@prisma/client';

export class SlotInputDto {
  @ApiProperty({ example: '2024-12-15' })
  @IsDateString()
  date: string;

  @ApiProperty({ enum: ['available', 'booked', 'blocked', 'past_work'] })
  @IsEnum(SlotStatus)
  status: SlotStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkAvailabilityDto {
  @ApiProperty({ type: [SlotInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SlotInputDto)
  slots: SlotInputDto[];
}
