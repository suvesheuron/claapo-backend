import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsArray, ValidateNested, IsDateString, IsString, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceLineItemDto } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ type: [InvoiceLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems?: InvoiceLineItemDto[];

  @ApiPropertyOptional({ enum: ['none', 'gst', 'igst'] })
  @IsOptional()
  @IsString()
  @IsIn(['none', 'gst', 'igst'])
  taxType?: 'none' | 'gst' | 'igst';

  @ApiPropertyOptional({ enum: [0, 5, 18] })
  @IsOptional()
  @IsInt()
  @IsIn([0, 5, 18])
  taxRatePct?: 0 | 5 | 18;
}
