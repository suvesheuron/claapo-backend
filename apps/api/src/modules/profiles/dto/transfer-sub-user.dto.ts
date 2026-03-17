import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TransferSubUserDto {
  @ApiProperty({
    description: 'ID of the main user to transfer this sub-user to (must be a main company/vendor account in the same role).',
  })
  @IsString()
  newMainUserId: string;
}

