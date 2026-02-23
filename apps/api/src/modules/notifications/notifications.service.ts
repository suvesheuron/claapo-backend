import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_EMAIL, QUEUE_PUSH } from '../../queue/queue.constants';
import { DEFAULT_JOB_OPTS } from '../../queue/queue.constants';
import type { EmailJobPayload, PushJobPayload } from '../../queue/job-payloads';
import { NotificationPreferencesDto } from './dto/preferences.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_PUSH) private readonly pushQueue: Queue,
  ) {}

  async list(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [rawItems, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const bookingRequestIds = rawItems
      .filter((n) => n.type === 'booking_request' && n.data && typeof (n.data as Record<string, unknown>).bookingId === 'string')
      .map((n) => (n.data as Record<string, unknown>).bookingId as string);
    const bookingStatuses = bookingRequestIds.length
      ? await this.prisma.bookingRequest.findMany({
          where: { id: { in: bookingRequestIds } },
          select: { id: true, status: true },
        })
      : [];
    const statusByBookingId = new Map(bookingStatuses.map((b) => [b.id, b.status]));
    const items = rawItems.map((n) => {
      if (n.type !== 'booking_request' || !n.data) return n;
      const data = n.data as Record<string, unknown>;
      const bookingId = data.bookingId as string | undefined;
      const status = bookingId ? statusByBookingId.get(bookingId) : undefined;
      return { ...n, data: { ...data, bookingStatus: status ?? null } };
    });
    return {
      items,
      meta: { total, page, limit, pages: Math.ceil(total / limit), unreadCount },
    };
  }

  async markRead(notificationId: string, userId: string) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException('Not your notification');
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
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

  /** Call from other services to create a notification (e.g. on booking request, invoice sent). Also enqueues push and email per user preferences. */
  async createForUser(userId: string, type: string, title: string, body?: string, data?: Record<string, unknown>) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body: body ?? null,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fcmToken: true, notificationPreferences: true },
    });
    if (!user) return notification;

    const prefs = (user.notificationPreferences as Record<string, boolean>) ?? { push: true, email: true, sms: false };

    if (prefs.email !== false && user.email) {
      const html = body ? `<p>${body.replace(/\n/g, '<br>')}</p>` : '';
      const emailPayload: EmailJobPayload = {
        to: user.email,
        subject: title,
        html: html || `<p>${title}</p>`,
        text: body ?? title,
      };
      await this.emailQueue.add('notification', emailPayload, { priority: 3, ...DEFAULT_JOB_OPTS });
    }

    if (prefs.push !== false && user.fcmToken) {
      const pushPayload: PushJobPayload = {
        userId,
        title,
        body: body ?? undefined,
        data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
      };
      await this.pushQueue.add('notification', pushPayload, { priority: 2, ...DEFAULT_JOB_OPTS });
    }

    return notification;
  }
}
