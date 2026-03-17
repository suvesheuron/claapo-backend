import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateBookingRequestDto } from './dto/booking-request.dto';
import { LockBookingDto } from './dto/lock-booking.dto';
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

  @Get('incoming')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'List incoming requests' })
  listIncoming(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listIncoming(user.id, user.role);
  }

  @Get('past')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
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

  @Patch(':id/accept')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Accept booking request' })
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.accept(id, user.id, user.role);
  }

  @Patch(':id/decline')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Decline booking request' })
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.decline(id, user.id, user.role);
  }

  @Patch(':id/lock')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Lock confirmed booking; optional shootDates/shootLocations' })
  lock(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body?: LockBookingDto) {
    return this.bookingsService.lock(id, user.id, body);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel request' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CancelBookingDto) {
    return this.bookingsService.cancel(id, user.id, body.reason);
  }

  @Patch(':id/request-cancel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Request cancellation of an accepted/locked booking (crew/vendor → awaits company approval)' })
  requestCancellation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CancelBookingDto) {
    return this.bookingsService.requestCancellation(id, user.id, body.reason);
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
}
