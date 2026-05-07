import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppCacheService } from '../../common/cache/app-cache.service';
import { cacheKeys } from '../../common/cache/cache-keys';
import { NotificationPreferencesDto } from './dto/preferences.dto';

// Short — the badge poll runs every 20 s on the frontend, so 30 s is enough
// to absorb spikes without making the badge feel stale.
const UNREAD_COUNT_TTL = 30;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  private async getNotificationAccountContext(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const accountUserId = user.mainUserId ?? user.id;
    const isSubUser = !!user.mainUserId;
    const sharesAccountNotifications =
      isSubUser && (user.role === UserRole.company || user.role === UserRole.vendor);
    return {
      role: user.role,
      userId: user.id,
      accountUserId,
      isSubUser,
      sharesAccountNotifications,
    };
  }

  async list(userId: string, page = 1, limit = 20) {
    const ctx = await this.getNotificationAccountContext(userId);
    const ownerNotificationUserId = ctx.sharesAccountNotifications ? ctx.accountUserId : userId;
    const skip = (page - 1) * limit;
    const [rawItems, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: ownerNotificationUserId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId: ownerNotificationUserId } }),
      this.prisma.notification.count({ where: { userId: ownerNotificationUserId, readAt: null } }),
    ]);
    const bookingIds = rawItems
      .filter((n) => n.data && typeof (n.data as Record<string, unknown>).bookingId === 'string')
      .map((n) => (n.data as Record<string, unknown>).bookingId as string);

    const bookingDetails = bookingIds.length
      ? await this.prisma.bookingRequest.findMany({
          where: { id: { in: bookingIds } },
          select: {
            id: true,
            status: true,
            project: {
              select: {
                id: true,
                title: true,
                startDate: true,
                endDate: true,
                shootDates: true,
              },
            },
            requester: {
              select: {
                id: true,
                email: true,
                companyProfile: { select: { companyName: true } },
              },
            },
            target: {
              select: {
                id: true,
                email: true,
                role: true,
                individualProfile: { select: { displayName: true, bio: true } },
                vendorProfile: { select: { companyName: true, aboutUs: true } },
              },
            },
            projectRole: {
              select: { roleName: true },
            },
          },
        })
      : [];

    const bookingById = new Map(bookingDetails.map((b) => [b.id, b]));

    const items = rawItems.map((n) => {
      if (!n.data) return n;
      const data = n.data as Record<string, unknown>;
      const bookingId = data.bookingId as string | undefined;
      if (!bookingId) return n;
      const booking = bookingById.get(bookingId);
      if (!booking) return n;

      const project: any = booking.project;
      const requester: any = booking.requester;
      const target: any = booking.target;
      const role: any = booking.projectRole;

      // Derive a sensible date range for the project. Prefer explicit
      // start/end dates; if missing, fall back to shootDates.
      let projectStart: unknown = project?.startDate ?? null;
      let projectEnd: unknown = project?.endDate ?? null;
      if ((!projectStart || !projectEnd) && Array.isArray(project?.shootDates) && project.shootDates.length > 0) {
        const sorted = [...project.shootDates].sort((a: Date, b: Date) => a.getTime() - b.getTime());
        projectStart = sorted[0] ?? projectStart;
        projectEnd = sorted[sorted.length - 1] ?? projectEnd;
      }

      const enrichedData: Record<string, unknown> = {
        ...data,
        bookingStatus: booking.status ?? null,
        projectTitle: (data.projectTitle as string | undefined) ?? project?.title ?? null,
        projectStartDate: projectStart ?? null,
        projectEndDate: projectEnd ?? null,
        requesterCompanyName: requester?.companyProfile?.companyName ?? null,
        requesterEmail: requester?.email ?? null,
        targetUserId: target?.id ?? null,
        targetRole: target?.role ?? null,
        targetDisplayName: target?.individualProfile?.displayName ?? target?.email ?? null,
        targetCompanyName: target?.vendorProfile?.companyName ?? null,
        roleName: role?.roleName ?? null,
      };

      return { ...n, data: enrichedData as Prisma.InputJsonValue };
    });
    return {
      items,
      meta: { total, page, limit, pages: Math.ceil(total / limit), unreadCount },
    };
  }

  /**
   * Cheap unread count for the nav badge. Account-aware (sub-users in shared
   * accounts see the parent's unread count). Cached briefly so repeated polls
   * don't hammer Postgres.
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const ctx = await this.getNotificationAccountContext(userId);
    const ownerNotificationUserId = ctx.sharesAccountNotifications ? ctx.accountUserId : userId;
    const count = await this.cache.wrap(
      cacheKeys.unreadNotificationCount(ownerNotificationUserId),
      UNREAD_COUNT_TTL,
      () =>
        this.prisma.notification.count({
          where: { userId: ownerNotificationUserId, readAt: null },
        }),
    );
    return { count };
  }

  /** Drop the cached unread-count for a notification owner. */
  private invalidateUnreadCount(ownerUserId: string) {
    return this.cache.del(cacheKeys.unreadNotificationCount(ownerUserId));
  }

  async markRead(notificationId: string, userId: string) {
    const ctx = await this.getNotificationAccountContext(userId);
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) throw new NotFoundException('Notification not found');
    const canReadOwn = n.userId === userId;
    const canReadAccount = ctx.sharesAccountNotifications && n.userId === ctx.accountUserId;
    if (!canReadOwn && !canReadAccount) throw new ForbiddenException('Not your notification');
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    await this.invalidateUnreadCount(n.userId);
    return updated;
  }

  async markAllRead(userId: string) {
    const ctx = await this.getNotificationAccountContext(userId);
    const ownerNotificationUserId = ctx.sharesAccountNotifications ? ctx.accountUserId : userId;
    await this.prisma.notification.updateMany({
      where: { userId: ownerNotificationUserId, readAt: null },
      data: { readAt: new Date() },
    });
    await this.invalidateUnreadCount(ownerNotificationUserId);
    return { message: 'All notifications marked as read' };
  }

  async updatePreferences(userId: string, dto: NotificationPreferencesDto) {
    const prefs = (dto.push !== undefined || dto.email !== undefined || dto.sms !== undefined)
      ? { push: dto.push, email: dto.email, sms: dto.sms }
      : undefined;
    if (!prefs) return this.getPreferences(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });
    const current = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    const next = { ...current, ...prefs };
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPreferences: next },
    });
    return { preferences: next };
  }

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });
    return { preferences: (user?.notificationPreferences as Record<string, boolean>) ?? { push: true, email: true, sms: false } };
  }

  async setFcmToken(userId: string, token: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
    return { message: 'FCM token updated' };
  }

  /** Call from other services to create a notification (e.g. on booking request, invoice sent). */
  async createForUser(userId: string, type: string, title: string, body?: string, data?: Record<string, unknown>) {
    const created = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body: body ?? null,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.invalidateUnreadCount(userId);
    return created;
  }
}
