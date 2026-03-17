import { Controller, Get, Patch, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { UpdateIndividualProfileDto } from './dto/update-individual-profile.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { PresignedUploadDto } from './dto/presigned-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { CreateSubUserDto } from './dto/create-sub-user.dto';
import { AssignSubUserProjectDto } from './dto/assign-sub-user-project.dto';
import { TransferSubUserDto } from './dto/transfer-sub-user.dto';

@ApiTags('profile')
@Controller('profile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile (any role)' })
  getMe(@CurrentUser() user: AuthUser) {
    return this.profilesService.getMe(user.id, user.role);
  }

  @Patch('individual')
  @UseGuards(RolesGuard)
  @Roles('individual')
  @ApiOperation({ summary: 'Update freelancer profile' })
  updateIndividual(@CurrentUser() user: AuthUser, @Body() dto: UpdateIndividualProfileDto) {
    return this.profilesService.updateIndividual(user.id, dto);
  }

  @Patch('company')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Update company profile' })
  updateCompany(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyProfileDto) {
    return this.profilesService.updateCompany(user.id, dto);
  }

  @Patch('vendor')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Update vendor profile' })
  updateVendor(@CurrentUser() user: AuthUser, @Body() dto: UpdateVendorProfileDto) {
    return this.profilesService.updateVendor(user.id, dto);
  }

  @Get('sub-users/list')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({ summary: 'List sub-users under current Main ID (company/vendor)' })
  listSubUsers(@CurrentUser() user: AuthUser) {
    return this.profilesService.listSubUsers(user.id, user.role);
  }

  @Post('sub-users')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({ summary: 'Create a sub-user under current Main ID (company/vendor)' })
  createSubUser(@CurrentUser() user: AuthUser, @Body() dto: CreateSubUserDto) {
    return this.profilesService.createSubUser(user.id, user.role, dto);
  }

  @Post('sub-users/:subUserId/assign-project')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({ summary: 'Assign a project to a sub-user (company/vendor)' })
  assignProjectToSubUser(
    @CurrentUser() user: AuthUser,
    @Param('subUserId') subUserId: string,
    @Body() dto: AssignSubUserProjectDto,
  ) {
    return this.profilesService.assignProjectToSubUser(user.id, user.role, subUserId, dto.projectId);
  }

  @Delete('sub-users/:subUserId')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({ summary: 'Remove (soft-delete) a sub-user (company/vendor Main ID only)' })
  deleteSubUser(@CurrentUser() user: AuthUser, @Param('subUserId') subUserId: string) {
    return this.profilesService.deleteSubUser(user.id, user.role, subUserId);
  }

  @Patch('sub-users/:subUserId/transfer')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({
    summary: 'Transfer a sub-user to another main user (company/vendor Main ID only)',
    description:
      'Reassigns a sub-user from the current main user to another main user of the same role. Existing bookings/projects remain attributed to the previous main; future actions will reflect the new main.',
  })
  transferSubUser(
    @CurrentUser() user: AuthUser,
    @Param('subUserId') subUserId: string,
    @Body() dto: TransferSubUserDto,
  ) {
    return this.profilesService.transferSubUser(user.id, user.role, subUserId, dto);
  }

  @Post('avatar')
  @ApiOperation({ summary: 'Get presigned URL to upload avatar (or logo for company/vendor)' })
  getAvatarUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: PresignedUploadDto) {
    return this.profilesService.getPresignedAvatarUrl(user.id);
  }

  @Post('avatar/confirm')
  @ApiOperation({ summary: 'Confirm avatar upload and set key on profile' })
  confirmAvatar(@CurrentUser() user: AuthUser, @Body() body: ConfirmUploadDto) {
    return this.profilesService.setAvatarKey(user.id, body.key);
  }

  @Post('showreel')
  @UseGuards(RolesGuard)
  @Roles('individual')
  @ApiOperation({ summary: 'Get presigned URL to upload showreel (individual only)' })
  getShowreelUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: PresignedUploadDto) {
    return this.profilesService.getPresignedShowreelUrl(user.id);
  }

  @Post('showreel/confirm')
  @UseGuards(RolesGuard)
  @Roles('individual')
  @ApiOperation({ summary: 'Confirm showreel upload and set key on profile' })
  confirmShowreel(@CurrentUser() user: AuthUser, @Body() body: ConfirmUploadDto) {
    return this.profilesService.setShowreelKey(user.id, body.key);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'View another user public profile' })
  getPublicProfile(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.profilesService.getPublicProfile(user.id, user.role, userId);
  }
}
