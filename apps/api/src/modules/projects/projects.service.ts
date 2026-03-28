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
    const ctx = await this.getCompanyAccountContext(companyUserId);
    if (!ctx.isMainUser) throw new ForbiddenException('Only Main ID can create projects');
    return this.prisma.project.create({
      data: {
        companyUserId: ctx.accountOwnerId,
        title: dto.title,
        productionHouseName: dto.productionHouseName,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
        shootDates: dto.shootDates?.map((d) => new Date(d)).filter((d) => !isNaN(d.getTime())) ?? [],
        shootLocations: dto.shootLocations?.map((s) => s.trim()).filter(Boolean) ?? [],
        locationCity: dto.locationCity,
        budget: dto.budget,
        status: 'draft',
      },
      include: { roles: true },
    });
  }

  async listOwn(companyUserId: string, page = 1, limit = 20) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const skip = (page - 1) * limit;
    const where = ctx.isMainUser
      ? { companyUserId: ctx.accountOwnerId }
      : {
          companyUserId: ctx.accountOwnerId,
          subUserAssignments: {
            some: { subUserId: companyUserId },
          },
        };
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: { roles: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    const projectIds = items.map((p) => p.id);
    const activeCounts =
      projectIds.length === 0
        ? []
        : await this.prisma.bookingRequest.groupBy({
            by: ['projectId'],
            where: {
              projectId: { in: projectIds },
              status: { in: ['pending', 'accepted', 'locked'] },
            },
            _count: { id: true },
          });
    const countByProjectId = new Map(activeCounts.map((c) => [c.projectId, c._count.id]));
    const itemsWithCount = items.map((p) => ({
      ...p,
      _count: { bookings: countByProjectId.get(p.id) ?? 0 },
    }));
    return {
      items: itemsWithCount,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getOne(projectId: string, userId: string, role: UserRole) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { roles: true, companyUser: { select: { id: true, email: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (role === UserRole.company) {
      const ctx = await this.getCompanyAccountContext(userId);
      if (project.companyUserId === ctx.accountOwnerId) {
        if (ctx.isMainUser) return project;
        const assigned = await this.prisma.subUserProjectAssignment.findFirst({
          where: { accountUserId: ctx.accountOwnerId, subUserId: userId, projectId },
        });
        if (assigned) return project;
      }
      throw new ForbiddenException('You do not have access to this project');
    }

    if (role === UserRole.vendor) {
      const vendorCtx = await this.getVendorAccountContext(userId);
      const hasBooking = await this.prisma.bookingRequest.findFirst({
        where: {
          projectId,
          targetUserId: vendorCtx.accountOwnerId,
          status: { in: ['accepted', 'locked'] },
          ...(vendorCtx.isMainUser
            ? {}
            : {
                project: {
                  subUserAssignments: {
                    some: { subUserId: userId, accountUserId: vendorCtx.accountOwnerId },
                  },
                },
              }),
        },
      });
      if (hasBooking) return project;
      throw new ForbiddenException('You do not have access to this project');
    }

    const hasBooking = await this.prisma.bookingRequest.findFirst({
      where: { projectId, targetUserId: userId, status: { in: ['accepted', 'locked'] } },
    });
    if (!hasBooking) throw new ForbiddenException('You do not have access to this project');
    return project;
  }

  async update(projectId: string, companyUserId: string, dto: UpdateProjectDto) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    if (!ctx.isMainUser) throw new ForbiddenException('Only Main ID can update project settings');
    await this.ensureOwnProject(projectId, ctx.accountOwnerId);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.productionHouseName !== undefined) data.productionHouseName = dto.productionHouseName;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.deliveryDate !== undefined) data.deliveryDate = dto.deliveryDate ? new Date(dto.deliveryDate) : null;
    if (dto.shootDates !== undefined) data.shootDates = dto.shootDates.map((d) => new Date(d)).filter((d) => !isNaN(d.getTime()));
    if (dto.shootLocations !== undefined) data.shootLocations = dto.shootLocations.map((s) => s.trim()).filter(Boolean);
    if (dto.locationCity !== undefined) data.locationCity = dto.locationCity;
    if (dto.budget !== undefined) data.budget = dto.budget;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.project.update({
      where: { id: projectId },
      data,
      include: { roles: true },
    });
  }

  async remove(projectId: string, companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    if (!ctx.isMainUser) throw new ForbiddenException('Only Main ID can delete projects');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== ctx.accountOwnerId) throw new ForbiddenException('Not your project');
    if (project.status !== 'draft') {
      throw new BadRequestException('Only draft projects can be deleted');
    }
    await this.prisma.project.delete({ where: { id: projectId } });
    return { message: 'Project deleted' };
  }

  async addRole(projectId: string, companyUserId: string, dto: AddProjectRoleDto) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    if (!ctx.isMainUser) throw new ForbiddenException('Only Main ID can edit role requirements');
    await this.ensureOwnProject(projectId, ctx.accountOwnerId);
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

  private async getCompanyAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) {
      throw new ForbiddenException('Only company users can perform this action');
    }
    const accountOwnerId = user.mainUserId ?? user.id;
    return { accountOwnerId, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) {
      throw new ForbiddenException('Only vendor users can perform this action');
    }
    const accountOwnerId = user.mainUserId ?? user.id;
    return { accountOwnerId, isMainUser: !user.mainUserId };
  }
}
