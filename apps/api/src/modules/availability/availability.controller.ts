import { Controller, Get, Put, Patch, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { BulkAvailabilityDto } from './dto/bulk-availability.dto';
import { SetSlotNoteDto } from './dto/set-slot-note.dto';

@ApiTags('availability')
@Controller('availability')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own calendar month view' })
  getMyCalendar(
    @CurrentUser() user: AuthUser,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = parseInt(year ?? String(new Date().getFullYear()), 10);
    const m = parseInt(month ?? String(new Date().getMonth() + 1), 10);
    // Accept 1-12 (calendar month); service expects 0-indexed
    const monthIndex = m >= 1 && m <= 12 ? m - 1 : Math.max(0, m);
    return this.availabilityService.getMyCalendar(user.id, y, monthIndex);
  }

  @Put('bulk')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Set availability for date range (bulk)' })
  bulkSet(@CurrentUser() user: AuthUser, @Body() body: BulkAvailabilityDto) {
    return this.availabilityService.bulkSet(user.id, user.role, body.slots);
  }

  @Patch('me/note')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Set work/equipment notes for a hired (booked) or past work date' })
  setSlotNote(@CurrentUser() user: AuthUser, @Body() body: SetSlotNoteDto) {
    return this.availabilityService.setSlotNote(user.id, user.role, body.date, body.notes);
  }

  @Get(':userId')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: "View target user's calendar (masked)" })
  getOtherCalendar(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = parseInt(year ?? String(new Date().getFullYear()), 10);
    const m = parseInt(month ?? String(new Date().getMonth() + 1), 10);
    // Accept 1–12 from clients; service expects 0-indexed
    const monthIndex = m >= 1 && m <= 12 ? m - 1 : Math.max(0, m);
    return this.availabilityService.getOtherUserCalendar(user.id, user.role, userId, y, monthIndex);
  }
}
