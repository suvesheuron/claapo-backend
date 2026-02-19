import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ description: 'Project ID this conversation is tied to' })
  @IsString()
  @IsUUID()
  projectId: string;

  @ApiProperty({ description: 'Other participant user ID' })
  @IsString()
  @IsUUID()
  otherUserId: string;
}
