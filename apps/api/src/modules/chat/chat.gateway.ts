import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessageType } from '@prisma/client';
import { ChatService } from './chat.service';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/auth.service';

export interface AuthenticatedSocket {
  id: string;
  data: { userId: string; user: AuthUser; mainUserId: string | null };
  join: (room: string) => void;
  leave: (room: string) => void;
  emit: (event: string, data: unknown) => void;
  to: (room: string) => { emit: (event: string, data: unknown) => void };
  disconnect: () => void;
}

const CONV_ROOM = (id: string) => `conversation:${id}`;
const USER_ROOM = (id: string) => `user:${id}`;

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*' },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit() {
    this.logger.log('Chat WebSocket gateway initialized');
  }

  async handleConnection(client: AuthenticatedSocket & { handshake?: { auth?: Record<string, unknown>; query?: Record<string, string | string[]> } }) {
    try {
      const auth = (client as { handshake?: { auth?: Record<string, unknown>; query?: Record<string, string | string[]> } }).handshake?.auth;
      const query = (client as { handshake?: { auth?: Record<string, unknown>; query?: Record<string, string | string[]> } }).handshake?.query;
      const authToken = auth?.token;
      const queryToken = query?.token;
      const token = typeof authToken === 'string' ? authToken : (Array.isArray(queryToken) ? queryToken[0] : queryToken);
      if (!token || typeof token !== 'string') {
        client.disconnect();
        return;
      }
      const secret = this.config.get<string>('jwt.secret');
      const payload = this.jwtService.verify<{ sub: string; email: string; role: string }>(token, { secret });

      // Fetch mainUserId for sub-user account awareness
      const userRecord = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { mainUserId: true } });
      const mainUserId = userRecord?.mainUserId ?? null;

      (client as AuthenticatedSocket).data = {
        userId: payload.sub,
        user: { id: payload.sub, email: payload.email, role: payload.role as AuthUser['role'] },
        mainUserId,
      };
      client.join(USER_ROOM(payload.sub));
      this.logger.debug(`User ${payload.sub} connected to chat`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(client: AuthenticatedSocket, conversationId: string) {
    const userId = client.data?.userId;
    if (!userId) return;

    try {
      const conv = await this.chatService.verifyMembership(userId, conversationId);
      if (conv) {
        client.join(CONV_ROOM(conversationId));
      }
    } catch {
      // ignore
    }
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(client: AuthenticatedSocket, conversationId: string) {
    client.leave(CONV_ROOM(conversationId));
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    client: AuthenticatedSocket,
    payload: { conversationId: string; type?: MessageType; content?: string; mediaKey?: string },
  ) {
    const userId = client.data?.userId;
    if (!userId) return { error: 'Unauthorized' };

    try {
      const message = await this.chatService.sendMessage(userId, payload.conversationId, {
        type: payload.type ?? 'text',
        content: payload.content,
        mediaKey: payload.mediaKey,
      });

      // Broadcast to each participant with their own isSameAccount computed
      const room = CONV_ROOM(payload.conversationId);
      const sockets = await this.server.in(room).fetchSockets();
      for (const socket of sockets) {
        const recipientId = (socket as unknown as AuthenticatedSocket).data?.userId;
        if (!recipientId) continue;
        const recipientMainUserId = (socket as unknown as AuthenticatedSocket).data?.mainUserId ?? null;
        const senderMainUserId = (message as any).senderMainUserId ?? null;
        // Compute isSameAccount: true if sender belongs to recipient's account
        const isSameAccount = recipientId === message.senderId
          || (senderMainUserId && senderMainUserId === recipientId)
          || (recipientMainUserId && message.senderId === recipientMainUserId)
          || (senderMainUserId && recipientMainUserId && senderMainUserId === recipientMainUserId);
        (socket as unknown as { emit: (event: string, data: unknown) => void }).emit('new_message', { ...message, isSameAccount });
      }
      return { ok: true, message };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  @SubscribeMessage('typing_start')
  handleTypingStart(client: AuthenticatedSocket, conversationId: string) {
    const userId = client.data?.userId;
    if (!userId) return;
    client.to(CONV_ROOM(conversationId)).emit('user_typing', { userId, conversationId });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(client: AuthenticatedSocket, conversationId: string) {
    const userId = client.data?.userId;
    if (!userId) return;
    client.to(CONV_ROOM(conversationId)).emit('user_stopped_typing', { userId, conversationId });
  }

  @SubscribeMessage('read_ack')
  async handleReadAck(client: AuthenticatedSocket, payload: { conversationId: string; messageIds?: string[] }) {
    const userId = client.data?.userId;
    if (!userId) return;

    try {
      await this.chatService.markAsRead(userId, payload.conversationId);
      client.to(CONV_ROOM(payload.conversationId)).emit('messages_read', {
        userId,
        conversationId: payload.conversationId,
      });
    } catch {
      // ignore
    }
  }

  /** Emit to a conversation room (e.g. when REST sends a message) */
  emitToConversation(conversationId: string, event: string, data: unknown) {
    this.server.to(CONV_ROOM(conversationId)).emit(event, data);
  }
}
