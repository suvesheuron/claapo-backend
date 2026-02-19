import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const keyId = this.config.get<string>('razorpay.keyId');
    const keySecret = this.config.get<string>('razorpay.keySecret');
    if (keyId && keySecret) {
      this.razorpay = new Razorpay({ key_id: keyId!, key_secret: keySecret! });
    }
  }

  private generateInvoiceNumber(): string {
    const prefix = 'INV';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  async create(issuerUserId: string, role: UserRole, dto: CreateInvoiceDto) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors can create invoices');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== dto.recipientUserId) throw new BadRequestException('Recipient must be the project company');
    let amount = 0;
    const lineItemsData = dto.lineItems.map((item) => {
      const itemAmount = item.quantity * item.unitPrice;
      amount += itemAmount;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: itemAmount,
      };
    });
    const gstAmount = Math.round(amount * 0.18);
    const totalAmount = amount + gstAmount;
    const invoiceNumber = this.generateInvoiceNumber();
    const invoice = await this.prisma.invoice.create({
      data: {
        projectId: dto.projectId,
        issuerUserId,
        recipientUserId: dto.recipientUserId,
        invoiceNumber,
        amount,
        gstAmount,
        totalAmount,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        lineItems: {
          create: lineItemsData,
        },
      },
      include: { lineItems: true, project: true },
    });
    return invoice;
  }

  async list(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          OR: [{ issuerUserId: userId }, { recipientUserId: userId }],
        },
        include: {
          lineItems: true,
          project: { select: { id: true, title: true, startDate: true, endDate: true } },
          issuer: {
            select: {
              id: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
          recipient: {
            select: {
              id: true,
              individualProfile: { select: { displayName: true } },
              companyProfile: { select: { companyName: true } },
              vendorProfile: { select: { companyName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({
        where: {
          OR: [{ issuerUserId: userId }, { recipientUserId: userId }],
        },
      }),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getOne(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, project: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== userId && invoice.recipientUserId !== userId) {
      throw new ForbiddenException('Not your invoice');
    }
    return invoice;
  }

  async update(invoiceId: string, userId: string, role: UserRole, dto: UpdateInvoiceDto) {
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can update');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== userId) throw new ForbiddenException('Not your invoice');
    if (invoice.status !== 'draft') throw new BadRequestException('Only draft invoices can be updated');
    const data: Record<string, unknown> = {};
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.lineItems?.length) {
      await this.prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
      let amount = 0;
      const lineItemsData = dto.lineItems.map((item) => {
        const itemAmount = item.quantity * item.unitPrice;
        amount += itemAmount;
        return {
          invoiceId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: itemAmount,
        };
      });
      const gstAmount = Math.round(amount * 0.18);
      data.amount = amount;
      data.gstAmount = gstAmount;
      data.totalAmount = amount + gstAmount;
      await this.prisma.invoiceLineItem.createMany({ data: lineItemsData });
    }
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data,
      include: { lineItems: true },
    });
  }

  async send(invoiceId: string, userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can send');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== userId) throw new ForbiddenException('Not your invoice');
    if (invoice.status !== 'draft') throw new BadRequestException('Only draft can be sent');
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'sent' },
      include: { lineItems: true },
    });
  }

  async cancel(invoiceId: string, userId: string, role: UserRole) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== userId) throw new ForbiddenException('Only issuer can cancel');
    if (invoice.status !== 'draft' && invoice.status !== 'sent') {
      throw new BadRequestException('Only draft or sent invoices can be cancelled');
    }
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'cancelled' },
      include: { lineItems: true },
    });
  }

  async getPdfUrl(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== userId && invoice.recipientUserId !== userId) throw new ForbiddenException('Not your invoice');
    if (!invoice.pdfKey) {
      return { message: 'PDF not yet generated. It will be available after the invoice is sent.', pdfUrl: null };
    }
    return { pdfKey: invoice.pdfKey, message: 'Use storage service to get presigned URL for this key' };
  }

  async initiatePayment(invoiceId: string, userId: string, role: UserRole) {
    if (role !== 'company') throw new ForbiddenException('Only company (recipient) can pay');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.recipientUserId !== userId) throw new ForbiddenException('Not your invoice');
    if (invoice.status !== 'sent') throw new BadRequestException('Invoice must be sent to pay');
    if (!this.razorpay) throw new BadRequestException('Razorpay is not configured');
    const amountInPaise = invoice.totalAmount;
    const order = await this.razorpay.orders.create({
      amount: amountInPaise,
      currency: invoice.currency,
      receipt: invoice.invoiceNumber,
      notes: { invoiceId },
    });
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { razorpayOrderId: order.id },
    });
    const keyId = this.config.get<string>('razorpay.keyId');
    return { orderId: order.id, amount: amountInPaise, currency: invoice.currency, keyId };
  }

  verifyRazorpayWebhook(payload: string, signature: string): boolean {
    const secret = this.config.get<string>('razorpay.webhookSecret');
    if (!secret) return false;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return expected === signature;
  }

  async handleRazorpayPaymentVerified(paymentPayload: { order_id: string }) {
    const orderId = paymentPayload.order_id;
    const invoice = await this.prisma.invoice.findFirst({
      where: { razorpayOrderId: orderId },
    });
    if (!invoice) return;
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'paid', paidAt: new Date() },
    });
  }
}
