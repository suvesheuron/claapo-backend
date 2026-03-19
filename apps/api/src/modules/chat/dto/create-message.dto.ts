import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, MaxLength, IsUUID } from 'class-validator';
import { MessageType } from '@prisma/client';

export class CreateMessageDto {
  @ApiPropertyOptional({ description: 'Text content (required for type text)' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ enum: MessageType, default: 'text' })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: 'S3 media key (for image/file types)' })
  @IsOptional()
  @IsString()
  mediaKey?: string;

  @ApiPropertyOptional({ description: 'ID of message being replied to' })
  @IsOptional()
  @IsString()
  @IsUUID()
  replyToId?: string;
}
