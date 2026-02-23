import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Ensure participant ordering for unique constraint: participantA < participantB */
  private orderParticipants(userId: string, otherUserId: string): [string, string] {
    return userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  }

  /** Create or get existing conversation (1-to-1, project-scoped) */
  async createOrGetConversation(userId: string, dto: CreateConversationDto) {
    const [participantA, participantB] = this.orderParticipants(userId, dto.otherUserId);

    // Verify user is one of the participants
    if (participantA !== userId && participantB !== userId) {
      throw new BadRequestException('Invalid other user');
    }

    // Verify project exists and user has access (company owner, or crew/vendor in project)
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { bookings: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const hasAccess =
      project.companyUserId === userId ||
      project.bookings.some((b) => (b.requesterUserId === userId || b.targetUserId === userId) && b.status !== 'declined' && b.status !== 'expired');
    if (!hasAccess) throw new ForbiddenException('No access to this project');

    let conv = await this.prisma.conversation.findUnique({
      where: {
        projectId_participantA_participantB: {
          projectId: dto.projectId,
          participantA,
          participantB,
        },
      },
      include: {
        project: { select: { id: true, title: true } },
        participantAUser: {
          select: {
            id: true,
            email: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        participantBUser: {
          select: {
            id: true,
            email: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
    });

    if (!conv) {
      conv = await this.prisma.conversation.create({
        data: {
          projectId: dto.projectId,
          participantA,
          participantB,
        },
        include: {
          project: { select: { id: true, title: true } },
          participantAUser: {
            select: {
              id: true,
              email: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
          participantBUser: {
            select: {
              id: true,
              email: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
        },
      });
    }

    return this.formatConversation(conv, userId);
  }

  /** List user's conversations (paginated, sorted by last message) */
  async listConversations(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: {
          OR: [{ participantA: userId }, { participantB: userId }],
        },
        include: {
          project: { select: { id: true, title: true } },
          participantAUser: {
            select: {
              id: true,
              email: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
          participantBUser: {
            select: {
              id: true,
              email: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where: {
          OR: [{ participantA: userId }, { participantB: userId }],
        },
      }),
    ]);

    return {
      items: items.map((c) => this.formatConversation(c, userId)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /** Get messages in conversation (cursor-based pagination, newest first) */
  async getMessages(userId: string, conversationId: string, cursor?: string, limit = 20) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.participantA !== userId && conv.participantB !== userId) {
      throw new ForbiddenException('Not a participant');
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: { id: true, email: true, individualProfile: { select: { displayName: true } }, companyProfile: { select: { companyName: true } }, vendorProfile: { select: { companyName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = messages.length > limit;
    const pageMessages = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? pageMessages[pageMessages.length - 1].id : null;

    return {
      items: pageMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        mediaKey: m.mediaKey,
        isRead: m.isRead,
        createdAt: m.createdAt,
        sender: {
          id: m.sender.id,
          displayName:
            m.sender.individualProfile?.displayName ?? m.sender.companyProfile?.companyName ?? m.sender.vendorProfile?.companyName ?? m.sender.email,
        },
      })),
      nextCursor,
    };
  }

  /** Send message (REST fallback if WebSocket fails) */
  async sendMessage(userId: string, conversationId: string, dto: CreateMessageDto) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.participantA !== userId && conv.participantB !== userId) {
      throw new ForbiddenException('Not a participant');
    }

    const type = (dto.type ?? 'text') as MessageType;
    if (type === 'text' && (!dto.content || !dto.content.trim())) {
      throw new BadRequestException('Content required for text messages');
    }
    if ((type === 'image' || type === 'file') && !dto.mediaKey) {
      throw new BadRequestException('mediaKey required for image/file messages');
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          type,
          content: dto.content?.trim() ?? null,
          mediaKey: dto.mediaKey ?? null,
        },
        include: { sender: { select: { id: true, individualProfile: { select: { displayName: true } }, companyProfile: { select: { companyName: true } }, vendorProfile: { select: { companyName: true } } } } },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      mediaKey: message.mediaKey,
      isRead: message.isRead,
      createdAt: message.createdAt,
      sender: {
        id: message.sender.id,
        displayName:
          message.sender.individualProfile?.displayName ?? message.sender.companyProfile?.companyName ?? message.sender.vendorProfile?.companyName ?? '—',
      },
    };
  }

  /** Mark all messages in conversation as read (for current user as recipient) */
  async markAsRead(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.participantA !== userId && conv.participantB !== userId) {
      throw new ForbiddenException('Not a participant');
    }

    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });
    return { message: 'Messages marked as read' };
  }

  /** Verify user is a participant in the conversation (for WebSocket room join) */
  async verifyMembership(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) return null;
    if (conv.participantA !== userId && conv.participantB !== userId) return null;
    return conv;
  }

  /** Get the other participant's user id in a conversation (for offline push). */
  async getOtherParticipantId(conversationId: string, currentUserId: string): Promise<string | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) return null;
    if (conv.participantA !== currentUserId && conv.participantB !== currentUserId) return null;
    return conv.participantA === currentUserId ? conv.participantB : conv.participantA;
  }

  /** Get presigned URL for chat media upload */
  async getMediaUploadUrl(userId: string, conversationId: string, contentType?: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.participantA !== userId && conv.participantB !== userId) {
      throw new ForbiddenException('Not a participant');
    }
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('Storage is not configured');
    }

    const ext = contentType?.includes('image') ? 'jpg' : contentType?.includes('video') ? 'mp4' : 'bin';
    const key = `chat/${conversationId}/${userId}/${Date.now()}.${ext}`;
    return this.storage.getPresignedPutUrl(key, contentType ?? 'application/octet-stream');
  }

  private formatConversation(conv: {
    id: string;
    projectId: string;
    participantA: string;
    participantB: string;
    lastMessageAt: Date | null;
    participantAUser: { id: string; email: string; individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
    participantBUser: { id: string; email: string; individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
    project: { id: string; title: string };
  }, currentUserId: string) {
    const other = conv.participantA === currentUserId ? conv.participantBUser : conv.participantAUser;
    const displayName =
      other.individualProfile?.displayName ?? other.companyProfile?.companyName ?? other.vendorProfile?.companyName ?? other.email;
    return {
      id: conv.id,
      projectId: conv.projectId,
      project: conv.project,
      otherParticipant: { id: other.id, email: other.email, displayName },
      lastMessageAt: conv.lastMessageAt,
    };
  }
}
