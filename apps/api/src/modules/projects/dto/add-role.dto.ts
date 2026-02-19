import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class AddProjectRoleDto {
  @ApiProperty({ example: 'DOP' })
  @IsString()
  roleName: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  qty?: number;

  @ApiPropertyOptional({ description: 'Rate min in INR' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Rate max in INR' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rateMax?: number;
}
