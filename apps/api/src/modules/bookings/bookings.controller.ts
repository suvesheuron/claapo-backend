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

  @Get('incoming')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'List incoming requests' })
  listIncoming(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listIncoming(user.id, user.role);
  }

  @Get('outgoing')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'List sent requests' })
  listOutgoing(@CurrentUser() user: AuthUser) {
    return this.bookingsService.listOutgoing(user.id);
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
  @ApiOperation({ summary: 'Lock confirmed booking' })
  lock(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingsService.lock(id, user.id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel request' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CancelBookingDto) {
    return this.bookingsService.cancel(id, user.id, body.reason);
  }
}
