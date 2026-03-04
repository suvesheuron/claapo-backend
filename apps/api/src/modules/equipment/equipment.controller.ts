import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UpdateEquipmentAvailabilityDto } from './dto/update-equipment-availability.dto';

@ApiTags('equipment')
@Controller('equipment')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get('me')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'List my equipment (vendor only)' })
  listMy(@CurrentUser() user: AuthUser) {
    return this.equipmentService.listMyEquipment(user.id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Add equipment item' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEquipmentDto) {
    return this.equipmentService.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Update equipment item' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.equipmentService.update(user.id, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Delete equipment item' })
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.equipmentService.delete(user.id, id);
  }

  @Get('vendor/:vendorUserId')
  @UseGuards(RolesGuard)
  @Roles('company', 'vendor')
  @ApiOperation({ summary: 'Get equipment list for a vendor (company or self)' })
  getForVendor(
    @CurrentUser() user: AuthUser,
    @Param('vendorUserId') vendorUserId: string,
  ) {
    return this.equipmentService.getEquipmentForVendor(vendorUserId);
  }

  @Post(':id/availability')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Add location/date availability for an equipment item' })
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateEquipmentAvailabilityDto,
  ) {
    return this.equipmentService.addAvailability(user.id, id, dto);
  }

  @Patch(':id/availability/:availabilityId')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Update location/date availability for an equipment item' })
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('availabilityId') availabilityId: string,
    @Body() dto: UpdateEquipmentAvailabilityDto,
  ) {
    return this.equipmentService.updateAvailability(user.id, id, availabilityId, dto);
  }

  @Delete(':id/availability/:availabilityId')
  @UseGuards(RolesGuard)
  @Roles('vendor')
  @ApiOperation({ summary: 'Delete location/date availability for an equipment item' })
  deleteAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('availabilityId') availabilityId: string,
  ) {
    return this.equipmentService.deleteAvailability(user.id, id, availabilityId);
  }
}
