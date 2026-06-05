import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { LOCATION_TYPES, type LocationType } from '../location-type.constants';

const normalizeUrl = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
};

export class UpdateLocationProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  propertyName?: string;

  @ApiPropertyOptional({ enum: LOCATION_TYPES })
  @IsOptional()
  @IsIn(LOCATION_TYPES as unknown as string[])
  locationType?: LocationType;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  subTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aboutUs?: string;

  // Location + Google map pin
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Latitude for the Google map pin' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  addressLat?: number;

  @ApiPropertyOptional({ description: 'Longitude for the Google map pin' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  addressLng?: number;

  @ApiPropertyOptional({ description: 'Google Maps share link (https://maps.app.goo.gl/...)' })
  @IsOptional()
  @IsString()
  mapLink?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationState?: string;

  // Social links
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  imdbUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  linkedinUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  twitterUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  youtubeUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeUrl)
  @IsString()
  vimeoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isAvailable?: boolean;

  // Billing / banking
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  panNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sacCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;
}
