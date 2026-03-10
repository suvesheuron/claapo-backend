import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateBookingRequestDto } from './dto/booking-request.dto';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createRequest(companyUserId: string, dto: CreateBookingRequestDto) {
    const companyCtx = await this.getCompanyAccountContext(companyUserId);
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { roles: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== companyCtx.accountOwnerId) throw new ForbiddenException('Not your project');
    if (!companyCtx.isMainUser) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: {
          accountUserId: companyCtx.accountOwnerId,
          subUserId: companyUserId,
          projectId: dto.projectId,
        },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (project.status !== 'draft' && project.status !== 'open') {
      throw new BadRequestException('Project must be draft or open to send requests');
    }
    const target = await this.prisma.user.findFirst({ where: { id: dto.targetUserId, deletedAt: null } });
    if (!target) throw new NotFoundException('Target user not found');
    if (target.role !== 'individual' && target.role !== 'vendor') {
      throw new BadRequestException('Target must be individual or vendor');
    }
    const targetAccountUserId = target.mainUserId ?? target.id;
    const existing = await this.prisma.bookingRequest.findFirst({
      where: {
        projectId: dto.projectId,
        targetUserId: targetAccountUserId,
        status: { in: ['pending', 'accepted', 'locked'] },
      },
    });
    if (existing) {
      const msg =
        existing.status === 'locked'
          ? 'This crew/vendor is already locked for this project.'
          : existing.status === 'accepted'
            ? 'This crew/vendor has already accepted a request for this project.'
            : 'A pending request already exists for this crew/vendor on this project.';
      throw new BadRequestException(msg);
    }
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const booking = await this.prisma.bookingRequest.create({
      data: {
        projectId: dto.projectId,
        requesterUserId: companyCtx.accountOwnerId,
        targetUserId: targetAccountUserId,
        projectRoleId: dto.projectRoleId,
        rateOffered: dto.rateOffered,
        message: dto.message,
        expiresAt,
      },
      include: { project: true, target: { select: { id: true, email: true, role: true } } },
    });
    await this.notifications.createForUser(
      targetAccountUserId,
      'booking_request',
      'New booking request',
      `You have a new booking request for project: ${booking.project.title}`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    return booking;
  }

  async listIncoming(userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors have incoming requests');
    }
    const incomingCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const items = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId: incomingCtx ? incomingCtx.accountOwnerId : userId,
        status: { in: ['pending', 'accepted', 'locked'] },
        ...(incomingCtx && !incomingCtx.isMainUser
          ? {
              project: {
                subUserAssignments: {
                  some: { accountUserId: incomingCtx.accountOwnerId, subUserId: userId },
                },
              },
            }
          : {}),
      },
      include: {
        project: true,
        requester: { select: { id: true, email: true, companyProfile: true } },
        projectRole: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  /** Past projects: bookings where user was crew/vendor and project is completed */
  async listPastBookings(userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors have past bookings');
    }
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const targetUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const items = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId,
        status: { in: ['accepted', 'locked'] },
        project: {
          status: 'completed',
          ...(vendorCtx && !vendorCtx.isMainUser
            ? {
                subUserAssignments: {
                  some: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId },
                },
              }
            : {}),
        },
      },
      include: {
        project: { select: { id: true, title: true, startDate: true, endDate: true, status: true } },
        requester: { select: { id: true, email: true, companyProfile: { select: { companyName: true } } } },
        projectRole: { select: { id: true, roleName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async listOutgoing(companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const items = await this.prisma.bookingRequest.findMany({
      where: {
        requesterUserId: ctx.accountOwnerId,
        ...(ctx.isMainUser
          ? {}
          : {
              project: {
                subUserAssignments: {
                  some: { accountUserId: ctx.accountOwnerId, subUserId: companyUserId },
                },
              },
            }),
      },
      include: {
        project: true,
        target: { select: { id: true, email: true, role: true, individualProfile: true, vendorProfile: true } },
        projectRole: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async accept(bookingId: string, userId: string, role: UserRole) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can accept');
    if (role === UserRole.vendor) {
      const vendorCtx = await this.getVendorAccountContext(userId);
      if (booking.targetUserId !== vendorCtx.accountOwnerId) throw new ForbiddenException('Not your booking');
      if (!vendorCtx.isMainUser) {
        const assigned = await this.prisma.subUserProjectAssignment.findFirst({
          where: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
        });
        if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
      }
    } else if (booking.targetUserId !== userId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    if (booking.expiresAt && booking.expiresAt < new Date()) {
      await this.prisma.bookingRequest.update({ where: { id: bookingId }, data: { status: 'expired' } });
      throw new BadRequestException('Request has expired');
    }
    const start = new Date(booking.project.startDate);
    const end = new Date(booking.project.endDate);
    const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    for (let t = startUtc; t <= endUtc; t += 24 * 60 * 60 * 1000) {
      const dateKey = new Date(t);
      await this.prisma.availabilitySlot.upsert({
        where: { userId_date: { userId: booking.targetUserId, date: dateKey } },
        create: { userId: booking.targetUserId, date: dateKey, status: 'booked' },
        update: { status: 'booked' },
      });
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'accepted', respondedAt: new Date() },
      include: { project: true },
    });
    await this.notifications.createForUser(
      booking.requesterUserId,
      'booking_accepted',
      'Booking accepted',
      `Your booking request for project "${booking.project.title}" was accepted.`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    return updated;
  }

  async decline(bookingId: string, userId: string, role: UserRole) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can decline');
    if (role === UserRole.vendor) {
      const vendorCtx = await this.getVendorAccountContext(userId);
      if (booking.targetUserId !== vendorCtx.accountOwnerId) throw new ForbiddenException('Not your booking');
      if (!vendorCtx.isMainUser) {
        const assigned = await this.prisma.subUserProjectAssignment.findFirst({
          where: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
        });
        if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
      }
    } else if (booking.targetUserId !== userId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    await this.notifications.createForUser(
      booking.requesterUserId,
      'booking_declined',
      'Booking declined',
      `Your booking request for project "${booking.project.title}" was declined.`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    return updated;
  }

  async lock(bookingId: string, companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.requesterUserId !== ctx.accountOwnerId) throw new ForbiddenException('Only the company can lock');
    if (!ctx.isMainUser) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: ctx.accountOwnerId, subUserId: companyUserId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status !== 'accepted') throw new BadRequestException('Only accepted bookings can be locked');
    return this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'locked', lockedAt: new Date() },
      include: { project: true, target: { select: { id: true, email: true } } },
    });
  }

  async cancel(bookingId: string, userId: string, reason?: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const requesterCtx = await this.getCompanyAccountContextOrNull(userId);
    const targetVendorCtx = await this.getVendorAccountContextOrNull(userId);
    const isRequester = booking.requesterUserId === (requesterCtx?.accountOwnerId ?? userId);
    const isTarget = booking.targetUserId === (targetVendorCtx?.accountOwnerId ?? userId) || booking.targetUserId === userId;
    if (!isRequester && !isTarget) throw new ForbiddenException('Not your booking');
    if (requesterCtx && !requesterCtx.isMainUser && isRequester) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: requesterCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (targetVendorCtx && !targetVendorCtx.isMainUser && isTarget) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: targetVendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status === 'locked') throw new BadRequestException('Locked bookings cannot be cancelled here');
    if (booking.status !== 'pending' && booking.status !== 'accepted') {
      throw new BadRequestException('Booking cannot be cancelled');
    }
    if (booking.status === 'accepted') {
      const start = new Date(booking.project.startDate);
      const end = new Date(booking.project.endDate);
      const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      for (let t = startUtc; t <= endUtc; t += 24 * 60 * 60 * 1000) {
        const dateKey = new Date(t);
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: booking.targetUserId, date: dateKey },
          data: { status: 'available' },
        });
      }
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelReason: reason,
        cancelledByUserId: userId,
        cancelledAt: new Date(),
      },
    });
    const notifyUserId = isRequester ? booking.targetUserId : booking.requesterUserId;
    const cancelledBySide = isRequester ? 'company' : 'crew_or_vendor';
    const reasonLine = reason?.trim() ? ` Reason: ${reason.trim()}` : '';
    await this.notifications.createForUser(
      notifyUserId,
      'booking_cancelled',
      'Booking request withdrawn/cancelled',
      `A booking request for project "${booking.project.title}" was cancelled.${reasonLine}`,
      {
        bookingId: booking.id,
        projectId: booking.projectId,
        cancelledByUserId: userId,
        cancelledBySide,
        cancelReason: reason ?? null,
        projectTitle: booking.project.title,
      },
    );
    return updated;
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

  private async getCompanyAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
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

  private async getVendorAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }
}
