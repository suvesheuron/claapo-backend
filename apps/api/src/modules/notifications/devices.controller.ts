import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { FcmTokenDto } from './dto/fcm-token.dto';

@ApiTags('devices')
@Controller('devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('fcm-token')
  @ApiOperation({ summary: 'Register or update FCM device token' })
  setFcmToken(@CurrentUser() user: AuthUser, @Body() dto: FcmTokenDto) {
    return this.notificationsService.setFcmToken(user.id, dto.token);
  }
}
