import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create or get conversation (project-scoped 1-to-1)' })
  createOrGet(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.chatService.createOrGetConversation(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List conversations (paginated, sorted by last message)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = parseInt(page ?? '1', 10);
    const limitNum = Math.min(parseInt(limit ?? '20', 10), 100);
    return this.chatService.listConversations(user.id, pageNum, limitNum);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages (cursor-based pagination, newest first)' })
  getMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.chatService.getMessages(user.id, id, query.cursor, query.limit);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send message (REST fallback if WebSocket fails)' })
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    const message = await this.chatService.sendMessage(user.id, id, dto);
    this.chatGateway.emitToConversation(id, 'new_message', message);
    return message;
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark messages as read' })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.markAsRead(user.id, id);
  }

  @Post(':id/media')
  @ApiOperation({ summary: 'Get presigned URL for chat media upload' })
  getMediaUploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { contentType?: string },
  ) {
    return this.chatService.getMediaUploadUrl(user.id, id, body.contentType);
  }
}
