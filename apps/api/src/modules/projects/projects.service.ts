import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvoiceTaxType, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
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
    // Validate the billing override: only allowed for casting directors and
    // only when the target company has actually hired this casting director
    // (an accepted/locked booking exists with the override target as requester
    // and the casting director's account as target).
    if (dto.billedToCompanyUserId) {
      await this.validateBillingOverride(ctx.accountOwnerId, dto.billedToCompanyUserId);
    }
    return this.prisma.project.create({
      data: {
        companyUserId: ctx.accountOwnerId,
        billedToCompanyUserId: dto.billedToCompanyUserId ?? null,
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
        // status omitted — schema default is `active` (Ongoing). The previous
        // draft → Activate Project step has been removed; projects go straight
        // to Ongoing on create.
      },
      include: { roles: true },
    });
  }

  /**
   * Asserts that `companyUserId` (a casting director) is allowed to bill
   * `targetCompanyUserId` for invoices on this project. The target must:
   *   1. Be an active company user
   *   2. Have an accepted or locked booking with the casting director as
   *      target (i.e. the casting director was hired by them).
   *
   * Throws ForbiddenException if either check fails.
   */
  private async validateBillingOverride(companyUserId: string, targetCompanyUserId: string) {
    if (companyUserId === targetCompanyUserId) {
      throw new BadRequestException('Cannot bill yourself');
    }
    const me = await this.prisma.user.findUnique({
      where: { id: companyUserId },
      include: { companyProfile: { select: { companyType: true } } },
    });
    if (!me || me.companyProfile?.companyType !== 'casting_director') {
      throw new ForbiddenException(
        'Project billing override is only available for Casting Director accounts',
      );
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetCompanyUserId, role: UserRole.company, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!target) throw new BadRequestException('Billing target must be an active company');
    const hiringBooking = await this.prisma.bookingRequest.findFirst({
      where: {
        requesterUserId: targetCompanyUserId,
        targetUserId: companyUserId,
        status: { in: ['accepted', 'locked'] },
      },
      select: { id: true },
    });
    if (!hiringBooking) {
      throw new BadRequestException(
        'You can only bill a company that has hired you (no accepted/locked booking found)',
      );
    }
  }

  /**
   * Lists companies that have hired the current casting director — i.e.
   * companies that issued an accepted or locked booking with this user as
   * target. Used to populate the "Bill invoices to" dropdown when a casting
   * director creates a project. Empty list = no valid billing-override
   * candidates; the project must bill to the casting director themselves.
   */
  async listBillingOptions(companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const me = await this.prisma.user.findUnique({
      where: { id: ctx.accountOwnerId },
      include: { companyProfile: { select: { companyType: true } } },
    });
    if (!me || me.companyProfile?.companyType !== 'casting_director') {
      return { items: [] };
    }
    const bookings = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId: ctx.accountOwnerId,
        status: { in: ['accepted', 'locked'] },
        requester: { role: UserRole.company, deletedAt: null, isActive: true },
      },
      select: {
        requester: {
          select: {
            id: true,
            email: true,
            displayName: true,
            companyProfile: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Set<string>();
    const items = [] as Array<{ id: string; label: string; email: string }>;
    for (const b of bookings) {
      if (!b.requester) continue;
      if (seen.has(b.requester.id)) continue;
      seen.add(b.requester.id);
      items.push({
        id: b.requester.id,
        label: b.requester.companyProfile?.companyName
          ?? b.requester.displayName
          ?? b.requester.email,
        email: b.requester.email,
      });
    }
    return { items };
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
      // Company: projects they own PLUS projects where they are a booking
      // target (company→company collaborations). Without the OR, the
      // receiving company would never see those projects in any page that
      // calls this endpoint (e.g. /conversations), so the conversation
      // would be unreachable on their side.
      //
      // Sub-users still scope down to assigned projects on the owner side
      // only — the booked-on path is shared by the whole account because
      // the assignment model maps sub-users to OWN projects, not to
      // bookings the account holds elsewhere.
      const ownedProjectsClause = isSubUser
        ? { companyUserId: mainUserId, subUserAssignments: { some: { subUserId: userId } } }
        : { companyUserId: mainUserId };
      const bookedOnProjectsClause = {
        bookings: {
          some: {
            targetUserId: mainUserId,
            status: { notIn: ['declined', 'expired', 'cancelled'] },
          },
        },
      };
      // Company→company inquiry flow: the receiving company can be in a
      // conversation on the owner's project BEFORE any booking exists (the
      // owner used the "Send Inquiry" flow). Without this clause the project
      // is invisible to the receiver in the /conversations project picker, so
      // the inquiry message has no entry point on their dashboard.
      const conversationOnProjectsClause = {
        conversations: {
          some: {
            OR: [
              { participantA: mainUserId },
              { participantB: mainUserId },
            ],
          },
        },
      };
      whereClause = {
        OR: [ownedProjectsClause, bookedOnProjectsClause, conversationOnProjectsClause],
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
    } else if (role === UserRole.cast) {
      // Cast: projects where they have bookings. Without this explicit
      // branch, cast users hit the admin `else` below and see every project
      // on the platform — which is the bug surfaced when a cast user opened
      // the Messages page and saw 60+ unrelated projects.
      whereClause = {
        bookings: {
          some: {
            targetUserId: userId,
            status: { notIn: ['declined', 'expired', 'cancelled'] },
          }
        }
      };
    } else if (role === UserRole.admin) {
      // Admin: all projects
      whereClause = {};
    } else {
      // Defensive default — unknown role gets an impossible filter so we
      // never accidentally leak every project on the platform again.
      whereClause = { id: '00000000-0000-0000-0000-000000000000' };
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
      // Company invoices for OWN projects are "received" (recipient=mainUserId),
      // but a company can also be a booked target on someone else's project
      // (company→company), where they're the ISSUER. Use an OR so both sides
      // show up in the project stats. Drafts are excluded only on the received
      // side to match the legacy "received invoices" page behavior.
      invoiceWhere.OR = [
        { recipientUserId: mainUserId, status: { not: 'draft' as const } },
        { issuerUserId: mainUserId },
      ];
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
              paidAmount: true,
            },
            _count: {
              _all: true,
            },
          });

    // Latest-message timestamp per project — drives the "latest project on
    // top" sort in the /conversations project picker. Pull MAX(lastMessageAt)
    // from conversations (already maintained per send) instead of joining
    // through messages, so this is a single grouped index scan.
    const conversationAggregates =
      projectIds.length === 0
        ? []
        : await this.prisma.conversation.groupBy({
            by: ['projectId'],
            where: { projectId: { in: projectIds } },
            _max: { lastMessageAt: true },
          });
    const lastMessageAtByProject = new Map<string, Date | null>();
    for (const row of conversationAggregates) {
      if (row.projectId) {
        lastMessageAtByProject.set(row.projectId, row._max.lastMessageAt ?? null);
      }
    }

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
      const sumPaid = row._sum.paidAmount ?? 0;

      if (row.status !== 'cancelled') {
        current.closureAmount += sumAmount;
        current.gstOrIgstAmount += sumTax;
        // paidAmount accumulates partial + full payments alike (cancelled
        // invoices are excluded because they never contribute to budget).
        current.paidAmount += sumPaid;
        if (row.status === 'sent' || row.status === 'overdue' || row.status === 'draft') {
          // Partial payments live in `sent`. The remaining balance after
          // applying paidAmount is what's still owed.
          current.unpaidAmount += Math.max(0, sumTotal - sumPaid);
        }
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
        // Latest chat activity on the project — null when no conversation
        // has any messages yet. Frontend uses it to sort projects so the
        // freshest chat bubbles up.
        lastMessageAt: lastMessageAtByProject.get(project.id) ?? null,
        conversationCount: project._count.conversations,
        invoiceCount: (amountStatsByProject.get(project.id)?.invoiceCount ?? 0),
        bookingCount: project._count.bookings,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}
