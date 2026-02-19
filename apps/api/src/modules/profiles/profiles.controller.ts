import { Controller, Get, Patch, Post, Body, Param, UseGuards } from '@nestjs/common';
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

  @Get(':userId')
  @ApiOperation({ summary: 'View another user public profile' })
  getPublicProfile(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.profilesService.getPublicProfile(user.id, user.role, userId);
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
}
