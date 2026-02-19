import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, Min, IsArray, ValidateNested, IsOptional, IsDateString } from 'class-validator';
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
}
