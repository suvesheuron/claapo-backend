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
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { roles: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== companyUserId) throw new ForbiddenException('Not your project');
    if (project.status !== 'draft' && project.status !== 'open') {
      throw new BadRequestException('Project must be draft or open to send requests');
    }
    const target = await this.prisma.user.findFirst({ where: { id: dto.targetUserId, deletedAt: null } });
    if (!target) throw new NotFoundException('Target user not found');
    if (target.role !== 'individual' && target.role !== 'vendor') {
      throw new BadRequestException('Target must be individual or vendor');
    }
    const existing = await this.prisma.bookingRequest.findFirst({
      where: { projectId: dto.projectId, targetUserId: dto.targetUserId, status: { in: ['pending', 'accepted'] } },
    });
    if (existing) throw new BadRequestException('A request already exists for this crew/vendor on this project');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const booking = await this.prisma.bookingRequest.create({
      data: {
        projectId: dto.projectId,
        requesterUserId: companyUserId,
        targetUserId: dto.targetUserId,
        projectRoleId: dto.projectRoleId,
        rateOffered: dto.rateOffered,
        message: dto.message,
        expiresAt,
      },
      include: { project: true, target: { select: { id: true, email: true, role: true } } },
    });
    await this.notifications.createForUser(
      dto.targetUserId,
      'booking_request',
      'New booking request',
      `You have a new booking request for project: ${booking.project.title}`,
      { bookingId: booking.id, projectId: booking.projectId },
    );
    return booking;
  }

  async listIncoming(userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors have incoming requests');
    }
    const items = await this.prisma.bookingRequest.findMany({
      where: { targetUserId: userId, status: { in: ['pending', 'accepted', 'locked'] } },
      include: {
        project: true,
        requester: { select: { id: true, email: true, companyProfile: true } },
        projectRole: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async listOutgoing(companyUserId: string) {
    const items = await this.prisma.bookingRequest.findMany({
      where: { requesterUserId: companyUserId },
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
    if (booking.targetUserId !== userId) throw new ForbiddenException('Not your booking');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can accept');
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    if (booking.expiresAt && booking.expiresAt < new Date()) {
      await this.prisma.bookingRequest.update({ where: { id: bookingId }, data: { status: 'expired' } });
      throw new BadRequestException('Request has expired');
    }
    const start = new Date(booking.project.startDate);
    const end = new Date(booking.project.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = new Date(d);
      dateKey.setHours(0, 0, 0, 0);
      await this.prisma.availabilitySlot.upsert({
        where: { userId_date: { userId: booking.targetUserId, date: dateKey } },
        create: { userId: booking.targetUserId, date: dateKey, status: 'booked' },
        update: { status: 'booked' },
      });
    }
    return this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'accepted', respondedAt: new Date() },
      include: { project: true },
    });
  }

  async decline(bookingId: string, userId: string, role: UserRole) {
    const booking = await this.prisma.bookingRequest.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.targetUserId !== userId) throw new ForbiddenException('Not your booking');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can decline');
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    return this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'declined', respondedAt: new Date() },
    });
  }

  async lock(bookingId: string, companyUserId: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.requesterUserId !== companyUserId) throw new ForbiddenException('Only the company can lock');
    if (booking.status !== 'accepted') throw new BadRequestException('Only accepted bookings can be locked');
    return this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'locked', lockedAt: new Date() },
      include: { project: true, target: { select: { id: true, email: true } } },
    });
  }

  async cancel(bookingId: string, userId: string, _reason?: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const isRequester = booking.requesterUserId === userId;
    const isTarget = booking.targetUserId === userId;
    if (!isRequester && !isTarget) throw new ForbiddenException('Not your booking');
    if (booking.status === 'locked') throw new BadRequestException('Locked bookings cannot be cancelled here');
    if (booking.status !== 'pending' && booking.status !== 'accepted') {
      throw new BadRequestException('Booking cannot be cancelled');
    }
    if (booking.status === 'accepted') {
      const start = new Date(booking.project.startDate);
      const end = new Date(booking.project.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = new Date(d);
        dateKey.setHours(0, 0, 0, 0);
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: booking.targetUserId, date: dateKey },
          data: { status: 'available' },
        });
      }
    }
    return this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'cancelled' },
    });
  }
}
