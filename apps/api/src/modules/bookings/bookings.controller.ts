import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateBookingRequestDto } from './dto/booking-request.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post('request')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Send booking request to crew/vendor' })
  createRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingRequestDto) {
    return this.bookingsService.createRequest(user.id, dto);
  }

  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Send booking requests to multiple crew/vendors' })
  async bulkRequest(@CurrentUser() user: AuthUser, @Body() body: { requests: CreateBookingRequestDto[] }) {
    const results = [];
    for (const dto of body.requests) {
      try {
        const booking = await this.bookingsService.createRequest(user.id, dto);
        results.push({ success: true, booking });
      } catch (err: any) {
        results.push({ success: false, targetUserId: dto.targetUserId, error: err.message ?? 'Failed' });
      }
    }
    return { results };
  }

  @Get('incoming')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'List incoming requests (crew, vendor, or company target)' })
  listIncoming(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listIncoming(user.id, user.role);
  }

  @Get('past')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'List past (completed) project bookings' })
  listPast(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listPastBookings(user.id, user.role);
  }

  @Get('outgoing')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'List sent requests' })
  listOutgoing(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listOutgoing(user.id);
  }

  @Get('cancel-requests')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'List bookings where crew/vendor requested cancellation' })
  listCancelRequests(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listCancelRequests(user.id);
  }

  // Counter offer feature removed as per Task 27 (2nd April)
  // @Patch(':id/counter')
  // @UseGuards(RolesGuard)
  // @Roles('individual', 'vendor')
  // @ApiOperation({ summary: 'Counter-offer on a pending booking request' })
  // counterOffer(
  //   @CurrentUser() user: AuthUser,
  //   @Param('id') id: string,
  //   @Body() body: { counterRate: number; counterMessage?: string },
  // ) {
  //   return this.bookingsService.counterOffer(id, user.id, user.role, body.counterRate, body.counterMessage);
  // }

  @Patch(':id/accept')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'Accept booking request (crew, vendor, or company target)' })
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.accept(id, user.id, user.role);
  }

  @Patch(':id/decline')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'Decline booking request (crew, vendor, or company target)' })
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.decline(id, user.id, user.role);
  }

  // Lock endpoints removed — the project flow no longer has a "Lock" step.
  // Service-level methods (`lock`, `lockAllProjectBookings`) are kept so that
  // legacy rows already in BookingStatus 'locked' continue to read correctly,
  // but they are not reachable from the API any more.

  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({
    summary:
      'Mark this booking complete. Target side (crew/vendor/company-as-target) stamps completedByTargetAt and sweeps their AvailabilitySlot rows to past_work. Requester side (production company that sent the request) stamps completedByRequesterAt only — added for the company→company hiring flow.',
  })
  markComplete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.markBookingComplete(id, user.id, user.role);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel request' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CancelBookingDto) {
    return this.bookingsService.cancel(id, user.id, body.reason);
  }

  @Patch(':id/request-cancel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'Request cancellation of an accepted/locked booking (needs approval from the other side)' })
  requestCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CancelBookingDto) {
    return this.bookingsService.requestCancellation(id, user.id, user.role, body.reason);
  }

  @Patch(':id/accept-cancel')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Company accepts the cancellation request' })
  acceptCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.respondToCancellation(id, user.id, true);
  }

  @Patch(':id/deny-cancel')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Company denies the cancellation request' })
  denyCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.respondToCancellation(id, user.id, false);
  }

  @Patch(':id/accept-company-cancel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'Target (crew/vendor/company) accepts company-initiated cancellation request' })
  acceptCompanyCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.respondToCompanyCancellation(id, user.id, user.role, true);
  }

  @Patch(':id/deny-company-cancel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company')
  @ApiOperation({ summary: 'Target (crew/vendor/company) denies company-initiated cancellation request' })
  denyCompanyCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.respondToCompanyCancellation(id, user.id, user.role, false);
  }
}
