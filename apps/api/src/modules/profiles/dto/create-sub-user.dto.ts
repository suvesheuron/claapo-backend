import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, Matches } from 'class-validator';

export class CreateSubUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+919900112233' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
