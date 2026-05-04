import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, Min, IsOptional, IsIn, MaxLength, MinLength, Matches, IsUUID } from 'class-validator';

export class RecordOfflineCompanyInvoiceDto {
  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'Billing / party name as on the offline document' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  billingName: string;

  @ApiProperty({ description: 'Department for internal company tracking' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  department: string;

  @ApiProperty({ description: 'Subtotal in paise (before tax)' })
  @IsInt()
  @Min(1)
  amountPaise: number;

  @ApiPropertyOptional({ enum: ['none', 'gst', 'igst'], default: 'none' })
  @IsOptional()
  @IsIn(['none', 'gst', 'igst'])
  taxType?: 'none' | 'gst' | 'igst';

  @ApiPropertyOptional({ enum: [0, 5, 18], default: 0 })
  @IsOptional()
  @IsInt()
  @IsIn([0, 5, 18])
  taxRatePct?: 0 | 5 | 18;

  @ApiPropertyOptional({ description: 'Invoice / project date shown on record (YYYY-MM-DD)', example: '2024-06-20' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  issuedOn?: string;
}
