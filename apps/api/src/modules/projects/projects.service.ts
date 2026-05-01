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

  async getProjectSubUsers(projectId: string, userId: string, role: UserRole) {
    // Verify project exists and user has access
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { subUserAssignments: { include: { subUser: { select: { id: true, email: true, displayName: true, individualProfile: { select: { displayName: true } } } } } } },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (role === UserRole.company) {
      const ctx = await this.getCompanyAccountContext(userId);
      if (project.companyUserId !== ctx.accountOwnerId) {
        throw new ForbiddenException('You do not have access to this project');
      }
    } else {
      throw new ForbiddenException('Only company users can view project assignments');
    }

    return {
      items: project.subUserAssignments,
    };
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

  async listUserProjectsWithStats(userId: string, role: UserRole, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    
    // Get user's main user ID context for sub-user handling
    const user = await this.prisma.user.findUnique({ 
      where: { id: userId }, 
      select: { mainUserId: true, role: true } 
    });
    const mainUserId = user?.mainUserId ?? userId;
    const isSubUser = !!user?.mainUserId;

    // Build where clause based on user role
    let whereClause: any = {};
    
    if (role === UserRole.company) {
      // Company: projects they own
      whereClause = {
        companyUserId: mainUserId,
        // For sub-users, only show assigned projects
        ...(isSubUser ? {
          OR: [
            { subUserAssignments: { some: { subUserId: userId } } },
          ]
        } : {}),
      };
    } else if (role === UserRole.vendor) {
      // Vendor: projects where they have bookings
      whereClause = {
        bookings: {
          some: {
            targetUserId: mainUserId,
            status: { notIn: ['declined', 'expired', 'cancelled'] },
          }
        }
      };
    } else if (role === UserRole.individual) {
      // Individual: projects where they have bookings
      whereClause = {
        bookings: {
          some: {
            targetUserId: userId,
            status: { notIn: ['declined', 'expired', 'cancelled'] },
          }
        }
      };
    } else {
      // Admin: all projects
      whereClause = {};
    }

    // Fetch projects with conversation and invoice counts
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where: whereClause,
        select: {
          id: true,
          title: true,
          status: true,
          startDate: true,
          endDate: true,
          budget: true,
          createdAt: true,
          _count: {
            select: {
              conversations: true,
              invoices: true,
              bookings: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.project.count({ where: whereClause }),
    ]);

    const projectIds = items.map((project) => project.id);
    const invoiceWhere: Record<string, unknown> = { projectId: { in: projectIds } };
    if (role === UserRole.company) {
      // Company invoices page is "received invoices", so count/aggregate by recipient.
      invoiceWhere.recipientUserId = mainUserId;
      invoiceWhere.status = { not: 'draft' as const };
    } else if (role === UserRole.vendor) {
      // Vendor should see only invoices sent by their own account.
      invoiceWhere.issuerUserId = mainUserId;
    } else if (role === UserRole.individual) {
      // Individual should see only invoices they sent.
      invoiceWhere.issuerUserId = userId;
    }

    const invoiceAggregates =
      projectIds.length === 0
        ? []
        : await this.prisma.invoice.groupBy({
            by: ['projectId', 'status'],
            where: invoiceWhere as any,
            _sum: {
              amount: true,
              gstAmount: true,
              totalAmount: true,
            },
            _count: {
              _all: true,
            },
          });

    const amountStatsByProject = new Map<
      string,
      {
        invoiceCount: number;
        closureAmount: number;
        gstOrIgstAmount: number;
        paidAmount: number;
        unpaidAmount: number;
      }
    >();

    for (const row of invoiceAggregates) {
      const current = amountStatsByProject.get(row.projectId) ?? {
        invoiceCount: 0,
        closureAmount: 0,
        gstOrIgstAmount: 0,
        paidAmount: 0,
        unpaidAmount: 0,
      };
      current.invoiceCount += row._count._all ?? 0;
      const sumAmount = row._sum.amount ?? 0;
      const sumTax = row._sum.gstAmount ?? 0;
      const sumTotal = row._sum.totalAmount ?? 0;

      if (row.status !== 'cancelled') {
        current.closureAmount += sumAmount;
        current.gstOrIgstAmount += sumTax;
      }
      if (row.status === 'paid') {
        current.paidAmount += sumTotal;
      } else if (row.status === 'sent' || row.status === 'overdue' || row.status === 'draft') {
        current.unpaidAmount += sumTotal;
      }
      amountStatsByProject.set(row.projectId, current);
    }

    return {
      items: items.map((project) => ({
        ...(amountStatsByProject.get(project.id) ?? {
          invoiceCount: 0,
          closureAmount: 0,
          gstOrIgstAmount: 0,
          paidAmount: 0,
          unpaidAmount: 0,
        }),
        id: project.id,
        title: project.title,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        approvedBudget: project.budget ?? 0,
        createdAt: project.createdAt,
        conversationCount: project._count.conversations,
        invoiceCount: (amountStatsByProject.get(project.id)?.invoiceCount ?? 0),
        bookingCount: project._count.bookings,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}
