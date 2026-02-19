import { Controller, Get, Patch, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import {
  AdminUsersQueryDto,
  AdminStatusDto,
  AdminBroadcastDto,
} from './dto/admin-query.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users with filters' })
  listUsers(@CurrentUser() _user: AuthUser, @Query() query: AdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate / deactivate / ban user' })
  updateUserStatus(@CurrentUser() _user: AuthUser, @Param('id') id: string, @Body() dto: AdminStatusDto) {
    return this.adminService.updateUserStatus(id, dto);
  }

  @Post('users/:id/verify-gst')
  @ApiOperation({ summary: 'Mark GST as verified for user profiles' })
  verifyGst(@CurrentUser() _user: AuthUser, @Param('id') id: string) {
    return this.adminService.verifyGst(id);
  }

  @Get('projects')
  @ApiOperation({ summary: 'List all projects' })
  listProjects(@CurrentUser() _user: AuthUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.listProjects(parseInt(page ?? '1', 10), parseInt(limit ?? '20', 10));
  }

  @Get('bookings')
  @ApiOperation({ summary: 'List all bookings (moderation)' })
  listBookings(@CurrentUser() _user: AuthUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.listBookings(parseInt(page ?? '1', 10), parseInt(limit ?? '20', 10));
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Financial overview' })
  listInvoices(@CurrentUser() _user: AuthUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.listInvoices(parseInt(page ?? '1', 10), parseInt(limit ?? '20', 10));
  }

  @Get('analytics/dashboard')
  @ApiOperation({ summary: 'KPI metrics snapshot' })
  getDashboard(@CurrentUser() _user: AuthUser) {
    return this.adminService.getDashboard();
  }

  @Get('analytics/revenue')
  @ApiOperation({ summary: 'Transaction summary' })
  getRevenue(@CurrentUser() _user: AuthUser) {
    return this.adminService.getRevenue();
  }

  @Post('broadcast')
  @ApiOperation({ summary: 'Send platform-wide notification' })
  broadcast(@CurrentUser() _user: AuthUser, @Body() dto: AdminBroadcastDto) {
    return this.adminService.broadcast(dto);
  }
}
