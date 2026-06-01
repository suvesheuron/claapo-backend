import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Request a presigned upload URL for a Work Showcase item. We accept any
 * image / video / document MIME type and the service maps it to the stored
 * `mediaType`. Validation of which types are allowed lives in the service so
 * unsupported types fail with a clear 400 rather than a generic class-validator
 * message.
 */
export class ShowcaseUploadUrlDto {
  @ApiProperty({ description: 'MIME type of the file to upload', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  contentType: string;
}
