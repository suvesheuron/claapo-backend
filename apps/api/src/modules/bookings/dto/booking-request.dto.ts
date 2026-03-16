import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateBookingRequestDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty({ description: 'Crew or vendor user ID' })
  @IsString()
  targetUserId: string;

  @ApiPropertyOptional({ description: 'Project role ID if booking for a specific role' })
  @IsOptional()
  @IsString()
  projectRoleId?: string;

  @ApiPropertyOptional({ description: 'Vendor equipment ID when booking a specific equipment from vendor search' })
  @IsOptional()
  @IsString()
  vendorEquipmentId?: string;

  @ApiPropertyOptional({ description: 'Rate offered in INR' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rateOffered?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;
}
