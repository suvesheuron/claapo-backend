import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateContactVisibilityDto {
  @ApiPropertyOptional({ description: 'Show email on the public profile' })
  @IsOptional()
  @IsBoolean()
  isEmailPublic?: boolean;

  @ApiPropertyOptional({ description: 'Show phone number on the public profile' })
  @IsOptional()
  @IsBoolean()
  isPhonePublic?: boolean;
}
