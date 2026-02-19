import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddProjectRoleDto } from './dto/add-role.dto';

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Create new project' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.id, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'List own projects (paginated)' })
  list(@CurrentUser() user: AuthUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.projectsService.listOwn(user.id, parseInt(page ?? '1', 10), parseInt(limit ?? '20', 10));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project detail' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projectsService.getOne(id, user.id, user.role);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Update project' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Delete project (draft only)' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projectsService.remove(id, user.id);
  }

  @Post(':id/roles')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Add role requirement to project' })
  addRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddProjectRoleDto) {
    return this.projectsService.addRole(id, user.id, dto);
  }
}
