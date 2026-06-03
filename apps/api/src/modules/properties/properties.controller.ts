import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CreatePropertyAvailabilityDto } from './dto/create-property-availability.dto';
import { UpdatePropertyAvailabilityDto } from './dto/update-property-availability.dto';
import { PropertyUploadUrlDto } from './dto/property-upload-url.dto';

@ApiTags('properties')
@Controller('properties')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'List my properties/setups (location only)' })
  listMy(@CurrentUser() user: AuthUser) {
    return this.propertiesService.listMine(user.id);
  }

  @Get('location/:locationUserId')
  @UseGuards(RolesGuard)
  @Roles('company', 'admin', 'location')
  @ApiOperation({ summary: 'List a location provider\'s properties (company picks one to book)' })
  getForLocation(@CurrentUser() _user: AuthUser, @Param('locationUserId') locationUserId: string) {
    return this.propertiesService.getPropertiesForLocation(locationUserId);
  }

  @Post('upload-url')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Get presigned URL to upload a property photo or PDF' })
  getUploadUrl(@CurrentUser() user: AuthUser, @Body() dto: PropertyUploadUrlDto) {
    return this.propertiesService.getUploadUrl(user.id, dto.kind, dto.contentType);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Add a property/setup listing' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Update a property/setup listing' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePropertyDto) {
    return this.propertiesService.update(user.id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Delete a property/setup listing' })
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.propertiesService.delete(user.id, id);
  }

  @Post(':id/availability')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Add date/location availability for a property' })
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreatePropertyAvailabilityDto,
  ) {
    return this.propertiesService.addAvailability(user.id, id, dto);
  }

  @Patch(':id/availability/:availabilityId')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Update date/location availability for a property' })
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('availabilityId') availabilityId: string,
    @Body() dto: UpdatePropertyAvailabilityDto,
  ) {
    return this.propertiesService.updateAvailability(user.id, id, availabilityId, dto);
  }

  @Delete(':id/availability/:availabilityId')
  @UseGuards(RolesGuard)
  @Roles('location')
  @ApiOperation({ summary: 'Delete date/location availability for a property' })
  deleteAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('availabilityId') availabilityId: string,
  ) {
    return this.propertiesService.deleteAvailability(user.id, id, availabilityId);
  }
}
