import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DeclineInvoiceDto {
  @ApiPropertyOptional({ description: 'Reason for declining invoice' })
  @IsOptional()
  @IsString()
  reason?: string;
}
