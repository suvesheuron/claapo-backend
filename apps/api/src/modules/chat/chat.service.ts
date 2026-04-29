import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { MessageType, UserRole } from '@prisma/client';
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
  async createOrGetConversation(userId: string, role: UserRole, dto: CreateConversationDto) {
    // For sub-users, use the main user's ID as the conversation participant so they share
    // conversations with the main account.
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mainUserId: true, role: true } });
    const participantUserId = user?.mainUserId ?? userId;

    const [participantA, participantB] = this.orderParticipants(participantUserId, dto.otherUserId);

    // Verify the resolved participant is the calling user or their main account
    if (participantA !== participantUserId && participantB !== participantUserId) {
      throw new BadRequestException('Invalid other user');
    }

    // Verify the other user exists and is active
    const otherUser = await this.prisma.user.findFirst({
      where: { id: dto.otherUserId, deletedAt: null, isActive: true },
    });
    if (!otherUser) {
      throw new NotFoundException('User not found or inactive');
    }

    // Verify project exists and user has access (main/sub account scope + assignment checks)
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { bookings: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    let hasAccess = false;
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    if (companyCtx && project.companyUserId === companyCtx.accountOwnerId) {
      if (!companyCtx.isMainUser) {
        await this.ensureProjectAssignedToSubUser(companyCtx.accountOwnerId, userId, dto.projectId);
      }
      hasAccess = true;
    }
    if (!hasAccess) {
      const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContextOrNull(userId) : null;
      const bookingActorId = vendorCtx ? vendorCtx.accountOwnerId : userId;
      const hasBooking = project.bookings.some(
        (b) =>
          (b.requesterUserId === bookingActorId || b.targetUserId === bookingActorId)
          && b.status !== 'declined'
          && b.status !== 'expired'
          && b.status !== 'cancelled',
      );
      hasAccess = hasBooking;
    }
    // Allow only main vendor users broad chat access.
    // Vendor sub-users must be explicitly assigned to the project.
    if (!hasAccess && role === UserRole.vendor && !user?.mainUserId) {
      hasAccess = true;
    }
    // Allow individual/crew users access if they are one of the conversation participants
    // This enables crew members to chat with company/vendor users on projects
    if (!hasAccess && role === UserRole.individual) {
      // Individual users can create conversations for any project they're invited to chat about
      // The access is validated by the fact that both participants must be valid users
      hasAccess = true;
    }
    if (!hasAccess) throw new ForbiddenException('No access to this project');

    // Use transaction to prevent race conditions when creating conversations
    let conv = await this.prisma.$transaction(async (tx) => {
      // Check if conversation already exists
      let existing = await tx.conversation.findUnique({
        where: {
          projectId_participantA_participantB: {
            projectId: dto.projectId,
            participantA,
            participantB,
          },
        },
        include: {
          project: { select: { id: true, title: true, shootDates: true } },
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

      // Create if it doesn't exist
      if (!existing) {
        existing = await tx.conversation.create({
          data: {
            projectId: dto.projectId,
            participantA,
            participantB,
          },
          include: {
            project: { select: { id: true, title: true, shootDates: true } },
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

      return existing;
    });

    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    return this.formatConversation(conv, userId);
  }

  /** Build a WHERE clause for conversations that a user (or their sub-users) can access */
  private async conversationWhereForUser(userId: string) {
    // Check if user is a sub-user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mainUserId: true, role: true },
    });
    if (user?.mainUserId) {
      if (user.role === UserRole.vendor) {
        return {
          OR: [
            { participantA: userId },
            { participantB: userId },
            { participantA: user.mainUserId },
            { participantB: user.mainUserId },
          ],
        };
      }
      // Company sub-user: strict by assigned projects.
      const assignments = await this.prisma.subUserProjectAssignment.findMany({
        where: { subUserId: userId },
        select: { projectId: true },
      });
      const projectIds = assignments.map((a) => a.projectId);

      // Company sub-user: include direct conversations + main user's conversations on assigned projects
      const clauses: any[] = [
        { participantA: userId },
        { participantB: userId },
      ];

      // Add main user's conversations on assigned projects
      if (projectIds.length > 0) {
        clauses.push({
          AND: [
            { project: { id: { in: projectIds } } },
            {
              OR: [
                { participantA: user.mainUserId },
                { participantB: user.mainUserId },
              ],
            },
          ],
        });
      }

      return { OR: clauses };
    }

    // Regular user: direct conversations only
    return { OR: [{ participantA: userId }, { participantB: userId }] };
  }

  /** List user's conversations (paginated, sorted by last message) */
  async listConversations(userId: string, page = 1, limit = 20, projectId?: string) {
    const skip = (page - 1) * limit;
    const baseWhere = await this.conversationWhereForUser(userId);
    
    // Add project filter if provided
    const where = projectId 
      ? { ...baseWhere, projectId } 
      : baseWhere;

    // Fetch mainUserId for sub-user context
    const userData = await this.prisma.user.findUnique({ where: { id: userId }, select: { mainUserId: true } });
    const mainUserId = userData?.mainUserId ?? null;

    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
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
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, content: true, senderId: true, createdAt: true, isRead: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conversation.count({
        where,
      }),
    ]);

    return {
      items: items.map((c) => this.formatConversation(c, userId, mainUserId)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /** Check if a user can access a conversation (direct participant or sub-user on assigned project) */
  private async canAccessConversation(userId: string, conv: { projectId: string; participantA: string; participantB: string }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mainUserId: true, role: true },
    });

    // Vendor sub-user: main account conversation visibility (no assignment gating).
    if (user?.mainUserId && user.role === UserRole.vendor) {
      return (
        conv.participantA === userId
        || conv.participantB === userId
        || conv.participantA === user.mainUserId
        || conv.participantB === user.mainUserId
      );
    }

    // Direct participant check
    if (conv.participantA === userId || conv.participantB === userId) return true;

    // Sub-user check: if user's main user is a participant and the project is assigned to this sub-user
    if (user?.mainUserId) {
      const isMainParticipant = conv.participantA === user.mainUserId || conv.participantB === user.mainUserId;
      if (!isMainParticipant) return false;
      const assignment = await this.prisma.subUserProjectAssignment.findFirst({
        where: { subUserId: userId, projectId: conv.projectId },
      });
      return !!assignment;
    }

    return false;
  }

  /** Format a message for API response with account-aware sender info */
  private formatMessage(m: any, currentUserId: string, mainUserId: string | null) {
    // Determine if sender belongs to the current user's account.
    // Two users are in the same account if:
    // 1. They are the same user (direct match)
    // 2. Sender is a subuser of the current main user (sender.mainUserId === currentUserId)
    // 3. Sender is the main user of the current subuser (senderId === currentUserId.mainUserId)
    // 4. Both are subusers under the same main user (sender.mainUserId === currentUserId.mainUserId)
    const senderMainUserId = m.sender?.mainUserId ?? null;
    const isSameAccount = m.senderId === currentUserId
      || (senderMainUserId && senderMainUserId === currentUserId)
      || (mainUserId && m.senderId === mainUserId)
      || (senderMainUserId && mainUserId && senderMainUserId === mainUserId);

    // Resolve a friendly display name for the sender
    // Priority: User.displayName (for sub-users) > profile displayName > company/vendor name > email
    const senderDisplayName =
      m.sender?.displayName
      ?? m.sender?.individualProfile?.displayName
      ?? m.sender?.companyProfile?.companyName
      ?? m.sender?.vendorProfile?.companyName
      ?? m.sender?.email
      ?? 'User';

    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderDisplayName,
      senderMainUserId,
      isSameAccount,
      type: m.type,
      content: m.content,
      mediaKey: m.mediaKey,
      isRead: m.isRead,
      isPinned: m.isPinned,
      deletedAt: m.deletedAt,
      forwardedFromId: m.forwardedFromId,
      replyToId: (m as any).replyToId ?? null,
      replyTo: m.replyTo ?? null,
      readAt: (m as any).readAt ?? (m.isRead ? m.createdAt : null) ?? null,
      createdAt: m.createdAt,
    };
  }

  /** Get messages in conversation (cursor-based pagination, newest first) */
  async getMessages(userId: string, conversationId: string, cursor?: string, limit = 20) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!(await this.canAccessConversation(userId, conv))) {
      throw new ForbiddenException('Not a participant');
    }

    // Fetch mainUserId for account-aware formatting
    const userData = await this.prisma.user.findUnique({ where: { id: userId }, select: { mainUserId: true } });
    const mainUserId = userData?.mainUserId ?? null;

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            displayName: true,
            mainUserId: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = messages.length > limit;
    const pageMessages = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? pageMessages[pageMessages.length - 1].id : null;

    return {
      items: pageMessages.map((m) => this.formatMessage(m, userId, mainUserId)),
      nextCursor,
    };
  }

  /** Send message (REST fallback if WebSocket fails) */
  async sendMessage(userId: string, conversationId: string, dto: CreateMessageDto) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!(await this.canAccessConversation(userId, conv))) {
      throw new ForbiddenException('Not a participant');
    }

    const type = (dto.type ?? 'text') as MessageType;
    if (type === 'text' && (!dto.content || !dto.content.trim())) {
      throw new BadRequestException('Content required for text messages');
    }
    if ((type === 'image' || type === 'file') && !dto.mediaKey) {
      throw new BadRequestException('mediaKey required for image/file messages');
    }

    const userData = await this.prisma.user.findUnique({ where: { id: userId }, select: { mainUserId: true } });
    const mainUserId = userData?.mainUserId ?? null;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId,
          senderId: userId,
          type,
          content: dto.content?.trim() ?? null,
          mediaKey: dto.mediaKey ?? null,
          replyToId: dto.replyToId ?? null,
        },
        include: {
          sender: {
            select: {
              id: true,
              mainUserId: true,
              email: true,
              displayName: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
          replyTo: { select: { id: true, content: true, senderId: true } },
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return this.formatMessage(message, userId, mainUserId);
  }

  /** Mark all messages in conversation as read (for current user as recipient) */
  async markAsRead(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!(await this.canAccessConversation(userId, conv))) {
      throw new ForbiddenException('Not a participant');
    }

    await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'Messages marked as read' };
  }

  /**
   * Called by BookingsService when a booking request is created.
   * Creates a conversation (if none exists) scoped to the project and sends
   * the booking request summary as the first message from the company.
   */
  async sendBookingRequestMessage(
    companyUserId: string,
    targetUserId: string,
    projectId: string,
    content: string,
  ) {
    const [participantA, participantB] = this.orderParticipants(companyUserId, targetUserId);

    let conv = await this.prisma.conversation.findUnique({
      where: {
        projectId_participantA_participantB: { projectId, participantA, participantB },
      },
    });

    if (!conv) {
      conv = await this.prisma.conversation.create({
        data: { projectId, participantA, participantB },
      });
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId: conv.id, senderId: companyUserId, type: 'text', content },
      }),
      this.prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return message;
  }

  /** Find (or return empty) conversation between two users, for the /with/:userId convenience route */
  async getConversationWithUser(userId: string, otherUserId: string, limit = 50) {
    const conv = await this.findMostRecentAccessibleConversationWithUser(userId, otherUserId);
    if (!conv) {
      return { conversationId: null, project: null, items: [] };
    }

    // Fetch mainUserId for account-aware formatting
    const userData = await this.prisma.user.findUnique({ where: { id: userId }, select: { mainUserId: true } });
    const mainUserId = userData?.mainUserId ?? null;

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conv.id },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            displayName: true,
            mainUserId: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        replyTo: { select: { id: true, content: true, senderId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const project = conv.projectId
      ? await this.prisma.project.findUnique({
          where: { id: conv.projectId },
          select: { id: true, title: true },
        })
      : null;
    return {
      conversationId: conv.id,
      project,
      items: messages.map((m) => this.formatMessage(m, userId, mainUserId)),
    };
  }

  /** Send a message to a user by their userId (finds the most recent shared conversation) */
  async sendMessageToUserByUserId(userId: string, otherUserId: string, content: string, replyToId?: string) {
    const conv = await this.findMostRecentAccessibleConversationWithUser(userId, otherUserId);
    if (!conv) {
      throw new NotFoundException('No conversation found. Start a chat from a shared project first.');
    }
    const dto: CreateMessageDto = { content, type: 'text', replyToId };
    return this.sendMessage(userId, conv.id, dto);
  }

  /** Resolve the latest conversation with a user in current account scope, enforcing access rules. */
  private async findMostRecentAccessibleConversationWithUser(userId: string, otherUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mainUserId: true },
    });
    const accountIds = user?.mainUserId ? [userId, user.mainUserId] : [userId];

    const candidates = await this.prisma.conversation.findMany({
      where: {
        OR: [
          { participantA: { in: accountIds }, participantB: otherUserId },
          { participantB: { in: accountIds }, participantA: otherUserId },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      select: { id: true, projectId: true, participantA: true, participantB: true },
    });

    for (const conv of candidates) {
      if (await this.canAccessConversation(userId, conv)) {
        return conv;
      }
    }
    return null;
  }

  /** Soft-delete a message (only the sender can delete) */
  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }
    if (message.deletedAt) {
      throw new BadRequestException('Message already deleted');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        content: null,
        mediaKey: null,
      },
    });
  }

  /** Toggle pin status on a message (either participant can pin) */
  async togglePinMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    const conv = message.conversation;
    if (!(await this.canAccessConversation(userId, conv))) {
      throw new ForbiddenException('Not a participant');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { isPinned: !message.isPinned },
    });
  }

  /** Forward a message to another conversation */
  async forwardMessage(userId: string, messageId: string, targetConversationId: string) {
    const originalMessage = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!originalMessage) throw new NotFoundException('Message not found');

    // Verify user is participant in source conversation
    const srcConv = originalMessage.conversation;
    if (!(await this.canAccessConversation(userId, srcConv))) {
      throw new ForbiddenException('Not a participant in source conversation');
    }

    // Verify user is participant in target conversation
    const targetConv = await this.prisma.conversation.findUnique({
      where: { id: targetConversationId },
    });
    if (!targetConv) throw new NotFoundException('Target conversation not found');
    if (!(await this.canAccessConversation(userId, targetConv))) {
      throw new ForbiddenException('Not a participant in target conversation');
    }

    if (originalMessage.deletedAt) {
      throw new BadRequestException('Cannot forward a deleted message');
    }

    const [forwardedMessage] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: targetConversationId,
          senderId: userId,
          type: originalMessage.type,
          content: originalMessage.content,
          mediaKey: originalMessage.mediaKey,
          forwardedFromId: originalMessage.id,
        },
        include: {
          sender: {
            select: {
              id: true,
              email: true,
              displayName: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
        },
      }),
      this.prisma.conversation.update({
        where: { id: targetConversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return {
      id: forwardedMessage.id,
      conversationId: forwardedMessage.conversationId,
      senderId: forwardedMessage.senderId,
      type: forwardedMessage.type,
      content: forwardedMessage.content,
      mediaKey: forwardedMessage.mediaKey,
      isRead: forwardedMessage.isRead,
      forwardedFromId: forwardedMessage.forwardedFromId,
      createdAt: forwardedMessage.createdAt,
      sender: {
        id: forwardedMessage.sender.id,
        displayName:
          forwardedMessage.sender.displayName ??
          forwardedMessage.sender.individualProfile?.displayName ??
          forwardedMessage.sender.companyProfile?.companyName ??
          forwardedMessage.sender.vendorProfile?.companyName ??
          '—',
      },
    };
  }

  /** Search messages across conversations the user participates in */
  async searchMessages(userId: string, query: string, conversationId?: string) {
    if (!query || !query.trim()) {
      throw new BadRequestException('Search query is required');
    }

    const whereClause: any = {
      content: { contains: query.trim(), mode: 'insensitive' },
      deletedAt: null,
      conversation: {
        OR: [{ participantA: userId }, { participantB: userId }],
      },
    };

    if (conversationId) {
      whereClause.conversationId = conversationId;
    }

    const messages = await this.prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            displayName: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        conversation: {
          select: { id: true, projectId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      items: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        type: m.type,
        content: m.content,
        mediaKey: m.mediaKey,
        isRead: m.isRead,
        isPinned: m.isPinned,
        createdAt: m.createdAt,
        sender: {
          id: m.sender.id,
          displayName:
            m.sender.displayName ??
            m.sender.individualProfile?.displayName ??
            m.sender.companyProfile?.companyName ??
            m.sender.vendorProfile?.companyName ??
            m.sender.email,
        },
      })),
    };
  }

  /**
   * List messages across every conversation in a project within a date range.
   * Used by the company dashboard's date-picker chat panel.
   */
  async getProjectMessagesByDate(
    userId: string,
    projectId: string,
    startIso: string,
    endIso: string,
    page = 1,
    limit = 50,
  ) {
    if (!startIso || !endIso) throw new BadRequestException('start and end are required');
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start or end date');
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    // Access: company owner (or sub-user assigned to the project)
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    if (!companyCtx || project.companyUserId !== companyCtx.accountOwnerId) {
      throw new ForbiddenException('No access to this project');
    }
    if (!companyCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(companyCtx.accountOwnerId, userId, projectId);
    }

    const where = {
      deletedAt: null,
      createdAt: { gte: start, lt: end },
      conversation: { projectId },
    } as const;

    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              email: true,
              displayName: true,
              mainUserId: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
          conversation: {
            select: { id: true, participantA: true, participantB: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where }),
    ]);

    const ownerId = companyCtx.accountOwnerId;

    // Fetch unique participant IDs (other than the company owner) to get their names
    const otherParticipantIds = new Set<string>();
    for (const m of rows) {
      const conv = m.conversation;
      const otherId = conv.participantA === ownerId
        ? conv.participantB
        : conv.participantB === ownerId
          ? conv.participantA
          : (conv.participantA === m.senderId ? conv.participantB : conv.participantA);
      if (otherId) otherParticipantIds.add(otherId);
    }
    
    // Fetch names of other participants
    const participantNames = new Map<string, string>();
    if (otherParticipantIds.size > 0) {
      const participants = await this.prisma.user.findMany({
        where: {
          id: { in: Array.from(otherParticipantIds) },
        },
        select: {
          id: true,
          email: true,
          individualProfile: { select: { displayName: true } },
          companyProfile: { select: { companyName: true } },
          vendorProfile: { select: { companyName: true } },
        },
      });
      for (const p of participants) {
        const name = p.individualProfile?.displayName ??
                     p.companyProfile?.companyName ??
                     p.vendorProfile?.companyName ??
                     p.email;
        participantNames.set(p.id, name);
      }
    }
    
    return {
      items: rows.map((m) => {
        const conv = m.conversation;
        const otherParticipantId = conv.participantA === ownerId
          ? conv.participantB
          : conv.participantB === ownerId
            ? conv.participantA
            : (conv.participantA === m.senderId ? conv.participantB : conv.participantA);

        // Compute isSameAccount: messages from the same account (main user or any subuser) show as "own"
        const senderMainUserId = m.sender?.mainUserId ?? null;
        const isSameAccount = m.senderId === ownerId || senderMainUserId === ownerId;

        return {
          id: m.id,
          content: m.content,
          createdAt: m.createdAt,
          conversationId: m.conversationId,
          otherParticipantId,
          otherParticipant: otherParticipantId ? {
            id: otherParticipantId,
            displayName: participantNames.get(otherParticipantId) ?? '—',
          } : undefined,
          sender: {
            id: m.sender.id,
            displayName:
              m.sender.displayName ??
              m.sender.individualProfile?.displayName ??
              m.sender.companyProfile?.companyName ??
              m.sender.vendorProfile?.companyName ??
              m.sender.email,
          },
          isSameAccount,
        };
      }),
      meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Verify user is a participant in the conversation (for WebSocket room join) */
  async verifyMembership(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) return null;
    if (!(await this.canAccessConversation(userId, conv))) return null;
    return conv;
  }

  /** Get presigned URL for chat media upload */
  async getMediaUploadUrl(userId: string, conversationId: string, contentType?: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (!(await this.canAccessConversation(userId, conv))) {
      throw new ForbiddenException('Not a participant');
    }
    if (!this.storage.isConfigured()) {
      throw new BadRequestException('Storage is not configured');
    }

    const ext = contentType?.includes('image') ? 'jpg' : contentType?.includes('video') ? 'mp4' : 'bin';
    const key = `chat/${conversationId}/${userId}/${Date.now()}.${ext}`;
    return this.storage.getPresignedPutUrl(key, contentType ?? 'application/octet-stream');
  }

  private async ensureProjectAssignedToSubUser(accountUserId: string, subUserId: string, projectId: string) {
    const assigned = await this.prisma.subUserProjectAssignment.findFirst({
      where: { accountUserId, subUserId, projectId },
      select: { id: true },
    });
    if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
  }

  private async getCompanyAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private formatConversation(conv: {
    id: string;
    projectId: string | null;
    participantA: string;
    participantB: string;
    lastMessageAt: Date | null;
    participantAUser: { id: string; email: string; individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
    participantBUser: { id: string; email: string; individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
    project: { id: string; title: string; shootDates?: Date[] } | null;
    messages?: { id: string; content: string | null; senderId: string; createdAt: Date; isRead: boolean }[];
  }, currentUserId: string, mainUserId: string | null = null) {
    // Determine the "other" participant
    let other: { id: string; email: string; individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };

    if (conv.participantA === currentUserId) {
      other = conv.participantBUser;
    } else if (conv.participantB === currentUserId) {
      other = conv.participantAUser;
    } else if (mainUserId) {
      // Sub-user: current user is not a direct participant. Find which participant is the main user
      // (same account) and return the OTHER one (the actual chat partner).
      if (conv.participantA === mainUserId) {
        other = conv.participantBUser;
      } else if (conv.participantB === mainUserId) {
        other = conv.participantAUser;
      } else {
        // Fallback — shouldn't happen if access control is correct
        other = conv.participantBUser;
      }
    } else {
      other = conv.participantBUser;
    }

    const displayName =
      other.individualProfile?.displayName ?? other.companyProfile?.companyName ?? other.vendorProfile?.companyName ?? other.email;
    const lastMsg = conv.messages?.[0] ?? null;
    return {
      id: conv.id,
      projectId: conv.projectId,
      project: conv.project
        ? {
            id: conv.project.id,
            title: conv.project.title,
            shootDates: Array.isArray(conv.project.shootDates)
              ? conv.project.shootDates.map((d) => d.toISOString())
              : [],
          }
        : null,
      otherParticipant: { id: other.id, email: other.email, displayName },
      lastMessageAt: conv.lastMessageAt,
      lastMessage: lastMsg
        ? { id: lastMsg.id, content: lastMsg.content, senderId: lastMsg.senderId, createdAt: lastMsg.createdAt, isRead: lastMsg.isRead }
        : null,
      unreadCount: conv.messages?.filter(m => !m.isRead && m.senderId !== currentUserId).length ?? 0,
    };
  }
}
