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
import { UpdateCastProfileDto } from './dto/update-cast-profile.dto';
import { PresignedUploadDto } from './dto/presigned-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { CreateSubUserDto } from './dto/create-sub-user.dto';
import { AssignSubUserProjectDto } from './dto/assign-sub-user-project.dto';
import { ShowcaseUploadUrlDto } from './dto/showcase-upload-url.dto';
import { CreateShowcaseItemDto } from './dto/create-showcase-item.dto';
import { CoverUploadDto } from './dto/cover-upload.dto';

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

  @Patch('cast')
  @UseGuards(RolesGuard)
  @Roles('cast')
  @ApiOperation({ summary: 'Update cast profile (actor/model)' })
  updateCast(@CurrentUser() user: AuthUser, @Body() dto: UpdateCastProfileDto) {
    return this.profilesService.updateCast(user.id, dto);
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

  @Post('avatar')
  @ApiOperation({ summary: 'Get presigned URL to upload avatar (or logo for company/vendor)' })
  getAvatarUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: PresignedUploadDto) {
    return this.profilesService.getPresignedAvatarUrl(user.id, dto.contentType);
  }

  @Post('avatar/confirm')
  @ApiOperation({ summary: 'Confirm avatar upload and set key on profile' })
  confirmAvatar(@CurrentUser() user: AuthUser, @Body() body: ConfirmUploadDto) {
    return this.profilesService.setAvatarKey(user.id, body.key);
  }

  @Post('cover')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company', 'cast')
  @ApiOperation({ summary: 'Get presigned URL to upload cover photo/video (individual/vendor/company/cast)' })
  getCoverUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: CoverUploadDto) {
    return this.profilesService.getPresignedCoverUrl(user.id, user.role, dto.contentType);
  }

  @Post('cover/confirm')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor', 'company', 'cast')
  @ApiOperation({ summary: 'Confirm cover photo upload and set key on profile' })
  confirmCover(@CurrentUser() user: AuthUser, @Body() body: ConfirmUploadDto) {
    return this.profilesService.setCoverKey(user.id, user.role, body.key);
  }

  @Post('showreel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'cast')
  @ApiOperation({ summary: 'Get presigned URL to upload showreel (individual/cast)' })
  getShowreelUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: PresignedUploadDto) {
    return this.profilesService.getPresignedShowreelUrl(user.id);
  }

  @Post('showreel/confirm')
  @UseGuards(RolesGuard)
  @Roles('individual', 'cast')
  @ApiOperation({ summary: 'Confirm showreel upload and set key on profile' })
  confirmShowreel(@CurrentUser() user: AuthUser, @Body() body: ConfirmUploadDto) {
    return this.profilesService.setShowreelKey(user.id, body.key);
  }

  @Get('showcase/list')
  @UseGuards(RolesGuard)
  @Roles('cast')
  @ApiOperation({ summary: 'List own Work Showcase items (cast)' })
  listShowcase(@CurrentUser() user: AuthUser) {
    return this.profilesService.listShowcaseItems(user.id);
  }

  @Post('showcase/upload-url')
  @UseGuards(RolesGuard)
  @Roles('cast')
  @ApiOperation({ summary: 'Get presigned URL to upload a Work Showcase item (image/video/document)' })
  getShowcaseUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: ShowcaseUploadUrlDto) {
    return this.profilesService.getShowcaseUploadUrl(user.id, dto.contentType);
  }

  @Post('showcase')
  @UseGuards(RolesGuard)
  @Roles('cast')
  @ApiOperation({ summary: 'Register an uploaded Work Showcase item (cast)' })
  createShowcaseItem(@CurrentUser() user: AuthUser, @Body() dto: CreateShowcaseItemDto) {
    return this.profilesService.createShowcaseItem(user.id, dto);
  }

  @Delete('showcase/:itemId')
  @UseGuards(RolesGuard)
  @Roles('cast')
  @ApiOperation({ summary: 'Delete a Work Showcase item (cast)' })
  deleteShowcaseItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.profilesService.deleteShowcaseItem(user.id, itemId);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'View another user public profile' })
  getPublicProfile(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.profilesService.getPublicProfile(user.id, user.role, userId);
  }
}
