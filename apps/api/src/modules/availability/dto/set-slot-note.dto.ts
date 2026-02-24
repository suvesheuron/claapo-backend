import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MaxLength } from 'class-validator';

export class SetSlotNoteDto {
  @ApiProperty({ example: '2024-12-15', description: 'Date (YYYY-MM-DD) of the booked/past_work slot' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Shot B-roll, operated camera. Equipment: Sony FX6.', required: false })
  @IsString()
  @MaxLength(2000)
  notes: string;
}
