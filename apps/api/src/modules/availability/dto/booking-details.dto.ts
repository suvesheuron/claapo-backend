import { ApiProperty } from '@nestjs/swagger';

export class BookingDetailsDto {
  @ApiProperty({ description: 'Booking ID' })
  id: string;

  @ApiProperty({ description: 'Project title' })
  projectTitle: string;

  @ApiProperty({ description: 'Project ID' })
  projectId: string;

  @ApiProperty({ description: 'Company/Requester user ID' })
  companyUserId: string;

  @ApiProperty({ description: 'Company name (if available)' })
  companyName?: string;

  @ApiProperty({ description: 'Individual/Vendor user ID' })
  targetUserId: string;

  @ApiProperty({ description: 'Target user display name' })
  targetDisplayName?: string;

  @ApiProperty({ description: 'Role name for the booking' })
  roleName?: string;

  @ApiProperty({ description: 'Rate offered in paise' })
  rateOffered?: number;

  @ApiProperty({ description: 'Booking status' })
  status: string;

  @ApiProperty({ description: 'Shoot dates' })
  shootDates: string[];

  @ApiProperty({ description: 'Shoot locations' })
  shootLocations: string[];

  @ApiProperty({ description: 'Message from company' })
  message?: string;

  @ApiProperty({ description: 'Invoice ID if exists for this booking', required: false })
  invoiceId?: string;

  @ApiProperty({ description: 'Invoice status if exists', required: false })
  invoiceStatus?: string;

  @ApiProperty({ description: 'Conversation ID if exists', required: false })
  conversationId?: string;
}
