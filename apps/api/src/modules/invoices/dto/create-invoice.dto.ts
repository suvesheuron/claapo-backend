import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, Min, IsArray, ValidateNested, IsOptional, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceLineItemDto {
  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiProperty({ description: 'Unit price in paise (INR × 100)' })
  @IsInt()
  @Min(0)
  unitPrice: number;
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty({ description: 'Company user ID (recipient)' })
  @IsString()
  recipientUserId: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems: InvoiceLineItemDto[];

  @ApiPropertyOptional({ enum: ['none', 'gst', 'igst'], default: 'none' })
  @IsOptional()
  @IsString()
  @IsIn(['none', 'gst', 'igst'])
  taxType?: 'none' | 'gst' | 'igst';

  @ApiPropertyOptional({ enum: [0, 5, 18], default: 0 })
  @IsOptional()
  @IsInt()
  @IsIn([0, 5, 18])
  taxRatePct?: 0 | 5 | 18;
}
