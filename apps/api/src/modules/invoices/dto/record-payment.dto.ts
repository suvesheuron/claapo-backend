import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class RecordPaymentDto {
  @ApiProperty({ enum: ['full', 'partial'], description: 'Full settles the entire balance; partial adds an instalment' })
  @IsEnum(['full', 'partial'])
  mode!: 'full' | 'partial';

  @ApiPropertyOptional({ description: 'Amount in paise (required when mode = partial)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountPaise?: number;
}
