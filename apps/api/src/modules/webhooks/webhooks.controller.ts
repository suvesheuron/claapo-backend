import { Controller, Post, Req, Headers, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { InvoicesService } from '../invoices/invoices.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('razorpay')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Razorpay payment webhook (HMAC verified)' })
  async razorpay(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const rawBody = (req as any).rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (!signature) throw new BadRequestException('Missing signature');
    const valid = this.invoicesService.verifyRazorpayWebhook(rawBody, signature);
    if (!valid) throw new BadRequestException('Invalid signature');
    const body = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
    const event = body.event;
    if (event === 'payment.captured') {
      const payload = body.payload?.payment?.entity;
      if (payload?.order_id) {
        await this.invoicesService.handleRazorpayPaymentVerified({ order_id: payload.order_id });
      }
    }
    return { received: true };
  }
}
