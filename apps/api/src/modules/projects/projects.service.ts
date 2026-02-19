import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddProjectRoleDto } from './dto/add-role.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyUserId: string, dto: CreateProjectDto) {
    if (new Date(dto.startDate) > new Date(dto.endDate)) {
      throw new BadRequestException('startDate must be before endDate');
    }
    return this.prisma.project.create({
      data: {
        companyUserId,
        title: dto.title,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        locationCity: dto.locationCity,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        status: 'draft',
      },
      include: { roles: true },
    });
  }

  async listOwn(companyUserId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where: { companyUserId },
        include: { roles: true, _count: { select: { bookings: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.project.count({ where: { companyUserId } }),
    ]);
    return {
      items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getOne(projectId: string, userId: string, role: UserRole) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { roles: true, companyUser: { select: { id: true, email: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId === userId) return project;
    const hasBooking = await this.prisma.bookingRequest.findFirst({
      where: { projectId, targetUserId: userId, status: { in: ['accepted', 'locked'] } },
    });
    if (!hasBooking) throw new ForbiddenException('You do not have access to this project');
    return project;
  }

  async update(projectId: string, companyUserId: string, dto: UpdateProjectDto) {
    await this.ensureOwnProject(projectId, companyUserId);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.locationCity !== undefined) data.locationCity = dto.locationCity;
    if (dto.budgetMin !== undefined) data.budgetMin = dto.budgetMin;
    if (dto.budgetMax !== undefined) data.budgetMax = dto.budgetMax;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.project.update({
      where: { id: projectId },
      data,
      include: { roles: true },
    });
  }

  async remove(projectId: string, companyUserId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== companyUserId) throw new ForbiddenException('Not your project');
    if (project.status !== 'draft') {
      throw new BadRequestException('Only draft projects can be deleted');
    }
    await this.prisma.project.delete({ where: { id: projectId } });
    return { message: 'Project deleted' };
  }

  async addRole(projectId: string, companyUserId: string, dto: AddProjectRoleDto) {
    await this.ensureOwnProject(projectId, companyUserId);
    return this.prisma.projectRole.create({
      data: {
        projectId,
        roleName: dto.roleName,
        qty: dto.qty ?? 1,
        rateMin: dto.rateMin,
        rateMax: dto.rateMax,
      },
    });
  }

  private async ensureOwnProject(projectId: string, companyUserId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== companyUserId) throw new ForbiddenException('Not your project');
  }
}
