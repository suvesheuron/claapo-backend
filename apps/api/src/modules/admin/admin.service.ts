import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdminUsersQueryDto, AdminStatusDto, AdminBroadcastDto } from './dto/admin-query.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listUsers(query: AdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.role) where.role = query.role;
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;
    if (query.search?.trim()) {
      where.OR = [
        { email: { contains: query.search.trim(), mode: 'insensitive' } },
        { phone: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          phone: true,
          role: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
          individualProfile: { select: { displayName: true } },
          companyProfile: { select: { companyName: true, isGstVerified: true } },
          vendorProfile: { select: { companyName: true, isGstVerified: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async updateUserStatus(userId: string, dto: AdminStatusDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    const isActive = dto.status === 'active';
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });
    return { message: 'Status updated', userId, isActive };
  }

  async verifyGst(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { companyProfile: true, vendorProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.companyProfile) {
      await this.prisma.companyProfile.update({
        where: { userId },
        data: { isGstVerified: true },
      });
    }
    if (user.vendorProfile) {
      await this.prisma.vendorProfile.update({
        where: { userId },
        data: { isGstVerified: true },
      });
    }
    return { message: 'GST marked verified', userId };
  }

  async listProjects(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        include: {
          companyUser: { include: { companyProfile: { select: { companyName: true } } } },
          _count: { select: { bookings: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.project.count(),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async listBookings(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.bookingRequest.findMany({
        include: {
          project: { select: { id: true, title: true } },
          requester: { include: { companyProfile: { select: { companyName: true } } } },
          target: { include: { individualProfile: true, vendorProfile: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bookingRequest.count(),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async listInvoices(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        include: { project: { select: { id: true, title: true } }, lineItems: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count(),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getDashboard() {
    const [usersTotal, projectsTotal, bookingsTotal, invoicesTotal, invoicesPaidTotal] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.project.count(),
      this.prisma.bookingRequest.count(),
      this.prisma.invoice.count(),
      this.prisma.invoice.aggregate({ where: { status: 'paid' }, _sum: { totalAmount: true } }),
    ]);
    return {
      usersTotal,
      projectsTotal,
      bookingsTotal,
      invoicesTotal,
      revenuePaise: invoicesPaidTotal._sum.totalAmount ?? 0,
    };
  }

  async getRevenue() {
    const byStatus = await this.prisma.invoice.groupBy({
      by: ['status'],
      _sum: { totalAmount: true },
      _count: true,
    });
    const paid = await this.prisma.invoice.aggregate({
      where: { status: 'paid' },
      _sum: { totalAmount: true },
      _count: true,
    });
    return {
      byStatus: byStatus.map((s) => ({ status: s.status, totalPaise: s._sum.totalAmount ?? 0, count: s._count })),
      paidTotalPaise: paid._sum.totalAmount ?? 0,
      paidCount: paid._count,
    };
  }

  async broadcast(dto: AdminBroadcastDto) {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    const title = dto.title ?? 'Platform update';
    const type = dto.type ?? 'broadcast';
    for (const u of users) {
      await this.notifications.createForUser(u.id, type, title, dto.body, undefined);
    }
    return { message: 'Broadcast sent', recipientCount: users.length };
  }
}
