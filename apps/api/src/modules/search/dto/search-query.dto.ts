import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsDateString, IsEnum, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { VendorType } from '@prisma/client';

export const SEARCH_PEOPLE_CATEGORIES = ['crew', 'vendor', 'company', 'cast', 'location'] as const;
export type SearchPeopleCategory = (typeof SEARCH_PEOPLE_CATEGORIES)[number];

export class SearchPeopleQueryDto {
  @ApiPropertyOptional({ description: 'Name query (partial match, case-insensitive)' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Restrict results to a single category. Omit to search across all three.',
    enum: SEARCH_PEOPLE_CATEGORIES,
  })
  @IsOptional()
  @IsIn(SEARCH_PEOPLE_CATEGORIES as unknown as string[])
  category?: SearchPeopleCategory;

  @ApiPropertyOptional({ description: 'City filter (case-insensitive contains).' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description:
      'Company type filter — only applied when category=company (e.g. Production House, Casting Director / Agency).',
  })
  @IsOptional()
  @IsString()
  companyType?: string;

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

export class SearchCrewQueryDto {
  @ApiPropertyOptional({ description: 'Skill or role, e.g. DOP or comma-separated' })
  @IsOptional()
  @IsString()
  skill?: string;

  @ApiPropertyOptional({ description: 'Genre filter, e.g. Drama, Comedy' })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({ description: 'Partial match on display name or email' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '2024-12-15' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-22' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Daily rate min INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Daily rate max INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMax?: number;

  @ApiPropertyOptional({ description: 'Only show available (isAvailable=true)' })
  @IsOptional()
  @Type(() => Boolean)
  availableOnly?: boolean;

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

export class SearchCastQueryDto {
  @ApiPropertyOptional({ description: 'Partial match on display name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Role type — actor or model' })
  @IsOptional()
  @IsIn(['actor', 'model'])
  roleType?: 'actor' | 'model';

  @ApiPropertyOptional({ description: 'Language filter (comma-separated)' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lookType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hairType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Daily rate min in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Daily rate max in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMax?: number;

  @ApiPropertyOptional({ description: 'Shoot window start (ISO date)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Shoot window end (ISO date)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

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

export class SearchLocationsQueryDto {
  @ApiPropertyOptional({ description: 'Search properties available in this city' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Location type filter (bungalow_villa_apartment | studio_setup | location_manager)' })
  @IsOptional()
  @IsString()
  locationType?: string;

  @ApiPropertyOptional({ description: 'Filter by a sub-type tag (e.g. Modern Bungalow)' })
  @IsOptional()
  @IsString()
  subType?: string;

  @ApiPropertyOptional({ description: 'Partial match on a property name' })
  @IsOptional()
  @IsString()
  propertyName?: string;

  @ApiPropertyOptional({ example: '2026-07-10' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-15' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Daily price min in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Daily price max in paise' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMax?: number;

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

export class SearchVendorsQueryDto {
  @ApiPropertyOptional({ enum: ['equipment', 'lighting', 'transport', 'catering'] })
  @IsOptional()
  @IsEnum(VendorType)
  type?: VendorType;

  @ApiPropertyOptional({ description: 'Search equipment available in this city/location' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: '2026-03-10' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-03-15' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by equipment item name' })
  @IsOptional()
  @IsString()
  equipmentName?: string;

  @ApiPropertyOptional({ description: 'Filter by vendor service category (Camera, Lights, ...)' })
  @IsOptional()
  @IsString()
  vendorServiceCategory?: string;

  @ApiPropertyOptional({ description: 'Daily budget min INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional({ description: 'Daily budget max INR' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rateMax?: number;
  //  company name s
  @ApiPropertyOptional({ description: 'Partial match on vendor company name' })
  @IsOptional()
  @IsString()
  companyName?: string;

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
