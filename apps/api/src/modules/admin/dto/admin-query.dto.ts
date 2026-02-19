import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminUsersQueryDto {
  @ApiPropertyOptional({ enum: ['individual', 'company', 'vendor', 'admin'] })
  @IsOptional()
  @IsIn(['individual', 'company', 'vendor', 'admin'])
  role?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @ApiPropertyOptional({ description: 'Search email or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class AdminStatusDto {
  @ApiProperty({ enum: ['active', 'inactive', 'banned'] })
  @IsIn(['active', 'inactive', 'banned'])
  status: string;
}

export class AdminBroadcastDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional()
  @IsOptional()
  type?: string;
}
