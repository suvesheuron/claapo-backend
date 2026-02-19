import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { VendorType } from '@prisma/client';

export class UpdateVendorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ enum: ['equipment', 'lighting', 'transport', 'catering'] })
  @IsOptional()
  @IsEnum(VendorType)
  vendorType?: VendorType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;
}
