import { Controller, Get, Put, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { BulkAvailabilityDto } from './dto/bulk-availability.dto';

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
    const m = parseInt(month ?? String(new Date().getMonth()), 10);
    return this.availabilityService.getMyCalendar(user.id, y, m);
  }

  @Put('bulk')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Set availability for date range (bulk)' })
  bulkSet(@CurrentUser() user: AuthUser, @Body() body: BulkAvailabilityDto) {
    return this.availabilityService.bulkSet(user.id, user.role, body.slots);
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
    const m = parseInt(month ?? String(new Date().getMonth()), 10);
    return this.availabilityService.getOtherUserCalendar(user.id, user.role, userId, y, m);
  }
}
