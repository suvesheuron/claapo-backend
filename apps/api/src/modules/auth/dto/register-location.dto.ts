import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { LOCATION_TYPES, type LocationType } from '../../profiles/location-type.constants';

export class RegisterLocationDto {
  @ApiProperty({ example: 'studio@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(/^\+?[1-9]\d{10,14}$/, { message: 'Invalid phone number' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty({ example: 'Sunrise Studios' })
  @IsString()
  @MinLength(2)
  propertyName: string;

  @ApiProperty({ enum: LOCATION_TYPES })
  @IsIn(LOCATION_TYPES as unknown as string[])
  locationType: LocationType;

  @ApiPropertyOptional({ example: '27AAExxxxxxxxZ5' })
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  locationCity?: string;
}
