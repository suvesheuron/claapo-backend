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
    // For Casting Director / Agency accounts the Projects list also includes
    // projects where THEY were hired (accepted/locked target booking). This
    // matches the spec: a CD hired by Dharma must see Dharma's project in
    // their Ongoing Projects so they can act on it (cast hires, etc.).
    // For all other companies the existing behavior — only owned projects —
    // is preserved.
    const owner = ctx.isMainUser
      ? await this.prisma.user.findUnique({
          where: { id: ctx.accountOwnerId },
          include: { companyProfile: { select: { companyType: true } } },
        })
      : null;
    const isCastingDirector = owner?.companyProfile?.companyType === 'casting_director';
    const ownedClause = ctx.isMainUser
      ? { companyUserId: ctx.accountOwnerId }
      : {
          companyUserId: ctx.accountOwnerId,
          subUserAssignments: {
            some: { subUserId: companyUserId },
          },
        };
    const where: any = isCastingDirector && ctx.isMainUser
      ? {
          OR: [
            ownedClause,
            {
              bookings: {
                some: {
                  targetUserId: ctx.accountOwnerId,
                  status: { in: ['accepted', 'locked'] },
                },
              },
            },
          ],
        }
      : ownedClause;
    // Fetch all matching projects (no DB pagination here) so we can sort by
    // "recent activity" — derived from project.updatedAt plus the max
    // updatedAt across bookings, conversations and invoices on the project.
    // Slicing happens in memory afterwards. Per-company project counts are
    // bounded enough that this stays cheap; if a single account ever grows
    // past a few hundred projects we can switch to a denormalized
    // `lastActivityAt` column on Project, but that's overkill today.
    const [allItems, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        include: { roles: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);
    const allIds = allItems.map((p) => p.id);
    const [activeCounts, activityMap] = await Promise.all([
      allIds.length === 0
        ? Promise.resolve([] as Array<{ projectId: string; _count: { id: number } }>)
        : this.prisma.bookingRequest.groupBy({
            by: ['projectId'],
            where: {
              projectId: { in: allIds },
              status: { in: ['pending', 'accepted', 'locked'] },
            },
            _count: { id: true },
          }),
      this.computeLastActivity(allIds),
    ]);
    const countByProjectId = new Map(activeCounts.map((c) => [c.projectId, c._count.id]));
    // Sort by recent activity desc. Falls back to project.updatedAt /
    // createdAt when no related rows exist (handled inside computeLastActivity).
    const sortedItems = [...allItems].sort((a, b) => {
      const da = activityMap.get(a.id)?.getTime() ?? a.updatedAt?.getTime() ?? a.createdAt.getTime();
      const db = activityMap.get(b.id)?.getTime() ?? b.updatedAt?.getTime() ?? b.createdAt.getTime();
      return db - da;
    });
    const pageItems = sortedItems.slice(skip, skip + limit);
    const itemsWithCount = pageItems.map((p) => ({
      ...p,
      _count: { bookings: countByProjectId.get(p.id) ?? 0 },
      lastActivityAt: activityMap.get(p.id) ?? p.updatedAt ?? p.createdAt,
    }));
    return {
      items: itemsWithCount,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Returns a Map<projectId, lastActivityAt> using the freshest of:
   *   - project.updatedAt
   *   - latest booking updatedAt on the project
   *   - latest conversation lastMessageAt / updatedAt on the project
   *   - latest invoice updatedAt on the project
   *
   * Drives the "most recently active project sorts first" rule used by all
   * project-list views (image #33).
   */
  private async computeLastActivity(projectIds: string[]): Promise<Map<string, Date>> {
    if (projectIds.length === 0) return new Map();
    const [bookingAgg, convoAgg, invoiceAgg, projects] = await Promise.all([
      this.prisma.bookingRequest.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _max: { updatedAt: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _max: { lastMessageAt: true, updatedAt: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _max: { updatedAt: true },
      }),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, updatedAt: true, createdAt: true },
      }),
    ]);
    const map = new Map<string, Date>();
    const bump = (id: string | null | undefined, d: Date | null | undefined) => {
      if (!id || !d) return;
      const cur = map.get(id);
      if (!cur || d > cur) map.set(id, d);
    };
    for (const p of projects) bump(p.id, p.updatedAt ?? p.createdAt);
    for (const b of bookingAgg) bump(b.projectId, b._max.updatedAt ?? null);
    for (const c of convoAgg) {
      bump(c.projectId, c._max.lastMessageAt ?? null);
      bump(c.projectId, c._max.updatedAt ?? null);
    }
    for (const i of invoiceAgg) bump(i.projectId, i._max.updatedAt ?? null);
    return map;
  }

  async getOne(projectId: string, userId: string, role: UserRole) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        roles: true,
        // Surface the project owner's companyType so the frontend can detect
        // CD-owned projects regardless of who's viewing (a CD viewing their
        // own project, a sub-user, etc.). Drives the "hide Crew/Vendor on
        // CD-owned projects" UI rule on ProjectDetail.
        companyUser: {
          select: {
            id: true,
            email: true,
            companyProfile: { select: { companyType: true, companyName: true } },
          },
        },
      },
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
      // Company hired ON this project (c2c). Already works for vendor below;
      // companies need the same check so a Casting Director hired by another
      // production house can open that project's detail page from their own
      // Projects list and book actors under it.
      const hiredBooking = await this.prisma.bookingRequest.findFirst({
        where: {
          projectId,
          targetUserId: ctx.accountOwnerId,
          status: { in: ['accepted', 'locked'] },
        },
        select: { id: true },
      });
      if (hiredBooking) return project;
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
    // Completed projects are an immutable historical record — finance,
    // invoicing, and past-work calendar slots depend on them.
    if (project.status === 'completed') {
      throw new BadRequestException('Completed projects cannot be deleted');
    }
    // Block delete when there's actual money on the line. Any paid (full or
    // partial) invoice keeps the project alive so we don't orphan payment
    // history. Users can cancel those invoices manually first if they
    // really need to remove the project.
    const paidInvoice = await this.prisma.invoice.findFirst({
      where: {
        projectId,
        OR: [
          { paidAmount: { gt: 0 } },
          { status: { in: ['paid', 'overdue', 'sent'] as const } },
        ],
      },
      select: { id: true, invoiceNumber: true, status: true, paidAmount: true },
    });
    if (paidInvoice && (paidInvoice.paidAmount > 0 || paidInvoice.status === 'paid')) {
      throw new BadRequestException(
        'Cannot delete a project with paid invoices. Cancel them first.',
      );
    }

    // Bookings and invoices don't cascade from Project in the schema (see
    // prisma/schema.prisma). Conversations / project roles / sub-user
    // assignments DO cascade. Reviews / contracts / invoice line items /
    // invoice attachments cascade from their owners. So in a transaction:
    //   1. For accepted/locked bookings, sweep the target's AvailabilitySlot
    //      rows back to 'available' so the crew's calendar isn't stuck
    //      "booked" for a project that no longer exists.
    //   2. Delete invoices (cascades line items + attachments).
    //   3. Delete bookings (cascades reviews + contracts).
    //   4. Delete the project (cascades conversations + roles + sub-user
    //      assignments).
    await this.prisma.$transaction(async (tx) => {
      const activeBookings = await tx.bookingRequest.findMany({
        where: { projectId, status: { in: ['accepted', 'locked'] } },
        select: { targetUserId: true, shootDates: true },
      });
      for (const b of activeBookings) {
        const dates = (b.shootDates ?? []).filter((d): d is Date => d instanceof Date);
        if (dates.length === 0) continue;
        await tx.availabilitySlot.updateMany({
          where: { userId: b.targetUserId, date: { in: dates }, status: 'booked' },
          data: { status: 'available' },
        });
      }
      await tx.invoice.deleteMany({ where: { projectId } });
      await tx.bookingRequest.deleteMany({ where: { projectId } });
      await tx.project.delete({ where: { id: projectId } });
    });
    return { message: 'Project deleted' };
  }

  /**
   * Lists ALL bookings on a project, scoped to viewers who already have access
   * to it. Unlike `/bookings/outgoing` (which is "bookings I requested"), this
   * returns every booking attached to the project — including ones requested
   * by a hired Casting Director on the project owner's behalf. Concretely:
   * Dharma owns "ABC Film", hires Casting Director Taran, Taran books actors
   * for the project. Dharma's ProjectDetail page calls this endpoint and sees
   * Taran's cast bookings on the project.
   *
   * Access: anyone who can read the project via `getOne` — project owner,
   * sub-users assigned to it, vendors/cast/individuals with accepted/locked
   * target bookings, and companies hired on the project (CDs etc.).
   */
  async listProjectBookings(projectId: string, userId: string, role: UserRole) {
    // Authorize — reuse getOne's access rules. If the user can't read the
    // project, getOne throws and we never reach the bookings query.
    await this.getOne(projectId, userId, role);
    const items = await this.prisma.bookingRequest.findMany({
      where: { projectId },
      include: {
        project: true,
        target: {
          select: {
            id: true,
            email: true,
            role: true,
            individualProfile: true,
            vendorProfile: true,
            companyProfile: { select: { companyName: true } },
            castProfile: { select: { displayName: true, roleType: true } },
          },
        },
        requester: {
          select: {
            id: true,
            email: true,
            role: true,
            companyProfile: { select: { companyName: true, companyType: true } },
          },
        },
        projectRole: true,
        vendorEquipment: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
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
      // Cast: projects where they have bookings OR are already in a
      // conversation on the project (inquiry-before-booking flow — a
      // casting director can chat a cast user about a project before any
      // booking exists). Without the second clause the cast user's
      // Messages page would be empty until they accept a booking, hiding
      // the inquiry message that triggered the conversation. Mirrors the
      // company branch above.
      whereClause = {
        OR: [
          {
            bookings: {
              some: {
                targetUserId: userId,
                status: { notIn: ['declined', 'expired', 'cancelled'] },
              },
            },
          },
          {
            conversations: {
              some: {
                OR: [
                  { participantA: userId },
                  { participantB: userId },
                ],
              },
            },
          },
        ],
      };
    } else if (role === UserRole.admin) {
      // Admin: all projects
      whereClause = {};
    } else {
      // Defensive default — unknown role gets an impossible filter so we
      // never accidentally leak every project on the platform again.
      whereClause = { id: '00000000-0000-0000-0000-000000000000' };
    }

    // Fetch projects with conversation and invoice counts. Same trick as
    // listOwn — pull all matching rows, sort by recent activity in memory,
    // then slice for pagination. The activity sort makes the most recently
    // touched project surface first (image #33) across crew / cast / vendor
    // views, not just companies.
    const [allItems, total] = await Promise.all([
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
          updatedAt: true,
          _count: {
            select: {
              conversations: true,
              invoices: true,
              bookings: true,
            }
          }
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.project.count({ where: whereClause }),
    ]);
    const activityMap = await this.computeLastActivity(allItems.map((p) => p.id));
    const sortedAll = [...allItems].sort((a, b) => {
      const da = activityMap.get(a.id)?.getTime() ?? a.updatedAt?.getTime() ?? a.createdAt.getTime();
      const db = activityMap.get(b.id)?.getTime() ?? b.updatedAt?.getTime() ?? b.createdAt.getTime();
      return db - da;
    });
    const items = sortedAll.slice(skip, skip + limit);

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
        // Aggregate "last touched" timestamp — drives the activity-first sort.
        lastActivityAt: activityMap.get(project.id) ?? project.updatedAt ?? project.createdAt,
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
