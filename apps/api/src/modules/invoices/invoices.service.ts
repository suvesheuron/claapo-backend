import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { AddInvoiceAttachmentDto } from './dto/add-invoice-attachment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

const INVOICE_ATTACHMENTS_PREFIX = 'invoices/';
const MAX_ATTACHMENTS_PER_INVOICE = 10;

@Injectable()
export class InvoicesService {
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
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
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(issuerUserId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : issuerUserId;
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, issuerUserId, dto.projectId);
    }
    const relatedBooking = await this.prisma.bookingRequest.findFirst({
      where: {
        projectId: dto.projectId,
        targetUserId: issuerAccountUserId,
        status: { in: ['accepted', 'locked'] },
      },
      select: { id: true },
    });
    if (!relatedBooking) {
      throw new ForbiddenException('You can create invoices only for projects where you are booked');
    }
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
        issuerUserId: issuerAccountUserId,
        recipientUserId: project.companyUserId,
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

  async list(userId: string, page = 1, limit = 20, issuedOn?: string) {
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    const vendorCtx = await this.getVendorAccountContextOrNull(userId);
    const skip = (page - 1) * limit;
    let issuedOnFilter: { createdAt: { gte: Date; lt: Date } } | undefined;
    if (issuedOn && /^\d{4}-\d{2}-\d{2}$/.test(issuedOn.trim())) {
      const start = new Date(issuedOn.trim() + 'T00:00:00.000Z');
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      issuedOnFilter = { createdAt: { gte: start, lt: end } };
    }
    const baseWhere = companyCtx
      ? {
          recipientUserId: companyCtx.accountOwnerId,
          ...(companyCtx.isMainUser
            ? {}
            : {
                project: {
                  subUserAssignments: {
                    some: { accountUserId: companyCtx.accountOwnerId, subUserId: userId },
                  },
                },
              }),
        }
      : vendorCtx
        ? {
            issuerUserId: vendorCtx.accountOwnerId,
            ...(vendorCtx.isMainUser
              ? {}
              : {
                  project: {
                    subUserAssignments: {
                      some: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId },
                    },
                  },
                }),
          }
        : {
            OR: [{ issuerUserId: userId }, { recipientUserId: userId }],
          };
    const where = issuedOnFilter ? { ...baseWhere, ...issuedOnFilter } : baseWhere;
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
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
      this.prisma.invoice.count({ where }),
    ]);
    return { items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getOne(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        attachments: true,
        project: { select: { id: true, title: true } },
        issuer: {
          select: {
            id: true,
            email: true,
            individualProfile: {
              select: {
                displayName: true,
                locationCity: true,
                skills: true,
                panNumber: true,
                bankAccountName: true,
                bankAccountNumber: true,
                ifscCode: true,
                bankName: true,
              },
            },
            vendorProfile: { select: { companyName: true, gstNumber: true, address: true } },
            companyProfile: { select: { companyName: true, locationCity: true, gstNumber: true, address: true } },
          },
        },
        recipient: {
          select: {
            id: true,
            email: true,
            individualProfile: {
              select: {
                displayName: true,
                locationCity: true,
                panNumber: true,
                bankAccountName: true,
                bankAccountNumber: true,
                ifscCode: true,
                bankName: true,
              },
            },
            vendorProfile: { select: { companyName: true, gstNumber: true, address: true } },
            companyProfile: { select: { companyName: true, locationCity: true, gstNumber: true, address: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.ensureInvoiceAccess(invoice.issuerUserId, invoice.recipientUserId, invoice.projectId, userId);
    return await this.formatInvoiceDetail(invoice);
  }

  async markAsPaid(invoiceId: string, userId: string) {
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    if (!companyCtx) throw new ForbiddenException('Only company users can mark invoices as paid');
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.recipientUserId !== companyCtx.accountOwnerId) throw new ForbiddenException('Not your invoice');
    if (invoice.status !== 'sent') throw new BadRequestException('Invoice must be sent before marking as paid');
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paidAt: new Date() },
      select: { id: true, status: true, paidAt: true },
    });
  }

  private async formatInvoiceDetail(invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    createdAt: Date;
    dueDate: Date | null;
    paidAt: Date | null;
    currency: string;
    amount: number;
    gstAmount: number;
    totalAmount: number;
    issuerUserId: string;
    recipientUserId: string;
    projectId: string;
    project: { id: string; title: string } | null;
    issuer: {
      id: string;
      email: string;
      individualProfile?: {
        displayName: string;
        locationCity?: string | null;
        skills?: string[];
        panNumber?: string | null;
        bankAccountName?: string | null;
        bankAccountNumber?: string | null;
        ifscCode?: string | null;
        bankName?: string | null;
      } | null;
      vendorProfile?: { companyName: string; gstNumber?: string | null; address?: string | null } | null;
      companyProfile?: {
        companyName: string;
        locationCity?: string | null;
        gstNumber?: string | null;
        address?: string | null;
      } | null;
    };
    recipient: {
      id: string;
      email: string;
      individualProfile?: {
        displayName: string;
        locationCity?: string | null;
        panNumber?: string | null;
        bankAccountName?: string | null;
        bankAccountNumber?: string | null;
        ifscCode?: string | null;
        bankName?: string | null;
      } | null;
      vendorProfile?: { companyName: string; gstNumber?: string | null; address?: string | null } | null;
      companyProfile?: {
        companyName: string;
        locationCity?: string | null;
        gstNumber?: string | null;
        address?: string | null;
      } | null;
    };
    lineItems: { description: string; quantity: unknown; unitPrice: number; amount: number }[];
    attachments?: { id: string; fileKey: string; fileName: string; mimeType: string; size: number }[];
  }) {
    const getName = (u: {
      email: string;
      individualProfile?: { displayName: string } | null;
      vendorProfile?: { companyName: string } | null;
      companyProfile?: { companyName: string } | null;
    }) => u.individualProfile?.displayName ?? u.vendorProfile?.companyName ?? u.companyProfile?.companyName ?? u.email;
    const getCity = (u: {
      individualProfile?: { locationCity?: string | null } | null;
      companyProfile?: { locationCity?: string | null } | null;
    }) => u.individualProfile?.locationCity ?? u.companyProfile?.locationCity ?? null;
    const issuerInd = invoice.issuer.individualProfile;
    const recipientInd = invoice.recipient.individualProfile;
    const issuerCompany = invoice.issuer.companyProfile;
    const issuerVendor = invoice.issuer.vendorProfile;
    const recipientCompany = invoice.recipient.companyProfile;
    const recipientVendor = invoice.recipient.vendorProfile;
    const issuerDetails = issuerInd
      ? {
          name: issuerInd.displayName,
          gstNumber: null as string | null,
          address: null as string | null,
          panNumber: issuerInd.panNumber ?? null,
          bankAccountName: issuerInd.bankAccountName ?? null,
          bankAccountNumber: issuerInd.bankAccountNumber ?? null,
          ifscCode: issuerInd.ifscCode ?? null,
          bankName: issuerInd.bankName ?? null,
        }
      : {
          name: issuerCompany?.companyName ?? issuerVendor?.companyName ?? invoice.issuer.email,
          gstNumber: issuerCompany?.gstNumber ?? issuerVendor?.gstNumber ?? null,
          address: issuerCompany?.address ?? issuerVendor?.address ?? null,
          panNumber: null as string | null,
          bankAccountName: null as string | null,
          bankAccountNumber: null as string | null,
          ifscCode: null as string | null,
          bankName: null as string | null,
        };
    const recipientDetails = recipientInd
      ? {
          name: recipientInd.displayName,
          gstNumber: null as string | null,
          address: null as string | null,
          panNumber: recipientInd.panNumber ?? null,
          bankAccountName: recipientInd.bankAccountName ?? null,
          bankAccountNumber: recipientInd.bankAccountNumber ?? null,
          ifscCode: recipientInd.ifscCode ?? null,
          bankName: recipientInd.bankName ?? null,
        }
      : {
          name: recipientCompany?.companyName ?? recipientVendor?.companyName ?? invoice.recipient.email,
          gstNumber: recipientCompany?.gstNumber ?? recipientVendor?.gstNumber ?? null,
          address: recipientCompany?.address ?? recipientVendor?.address ?? null,
          panNumber: null as string | null,
          bankAccountName: null as string | null,
          bankAccountNumber: null as string | null,
          ifscCode: null as string | null,
          bankName: null as string | null,
        };
    const taxRatePct = invoice.amount > 0 ? Math.round((invoice.gstAmount / invoice.amount) * 100) : 18;
    const attachmentsWithUrls = (invoice.attachments ?? []).map(async (a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      downloadUrl: await this.storage.getSignedUrl(a.fileKey),
    }));
    const attachments = await Promise.all(attachmentsWithUrls);
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issuedAt: invoice.createdAt.toISOString(),
      dueDate: invoice.dueDate?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      currency: invoice.currency,
      projectTitle: invoice.project?.title ?? null,
      projectId: invoice.projectId,
      fromName: getName(invoice.issuer),
      fromRole: issuerInd?.skills?.[0] ?? null,
      fromCity: getCity(invoice.issuer),
      toName: getName(invoice.recipient),
      toCity: getCity(invoice.recipient),
      issuerDetails,
      recipientDetails,
      lineItems: invoice.lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitAmountPaise: li.unitPrice,
      })),
      subtotalPaise: invoice.amount,
      taxRatePct,
      taxAmountPaise: invoice.gstAmount,
      totalPaise: invoice.totalAmount,
      notes: null,
      issuerId: invoice.issuerUserId,
      recipientId: invoice.recipientUserId,
      attachments,
    };
  }

  async update(invoiceId: string, userId: string, role: UserRole, dto: UpdateInvoiceDto) {
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can update');
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Not your invoice');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, invoice.projectId);
    }
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
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        project: { select: { id: true, title: true } },
        issuer: {
          select: {
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Not your invoice');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, invoice.projectId);
    }
    if (invoice.status !== 'draft') throw new BadRequestException('Only draft can be sent');
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'sent' },
      include: { lineItems: true },
    });
    const issuerName =
      invoice.issuer.individualProfile?.displayName ??
      invoice.issuer.vendorProfile?.companyName ??
      invoice.issuer.companyProfile?.companyName ??
      'A crew member';
    const amountFormatted = `₹${(invoice.totalAmount / 100).toLocaleString('en-IN')}`;
    await this.notifications.createForUser(
      invoice.recipientUserId,
      'invoice_sent',
      'New invoice received',
      `${issuerName} sent you an invoice for ${amountFormatted} for project "${invoice.project.title}".`,
      { invoiceId: invoice.id, projectId: invoice.projectId, projectTitle: invoice.project.title },
    );
    return updated;
  }

  async cancel(invoiceId: string, userId: string, role: UserRole) {
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContextOrNull(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Only issuer can cancel');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, invoice.projectId);
    }
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
    await this.ensureInvoiceAccess(invoice.issuerUserId, invoice.recipientUserId, invoice.projectId, userId);
    if (!invoice.pdfKey) {
      return { message: 'PDF not yet generated. It will be available after the invoice is sent.', pdfUrl: null };
    }
    return { pdfKey: invoice.pdfKey, message: 'Use storage service to get presigned URL for this key' };
  }

  async getAttachmentUploadUrl(invoiceId: string, userId: string, role: UserRole, contentType?: string) {
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can add attachments');
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { _count: { select: { attachments: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Not your invoice');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, invoice.projectId);
    }
    if (invoice.status !== 'draft' && invoice.status !== 'sent') {
      throw new BadRequestException('Attachments can only be added to draft or sent invoices');
    }
    if (invoice._count.attachments >= MAX_ATTACHMENTS_PER_INVOICE) {
      throw new BadRequestException(`Maximum ${MAX_ATTACHMENTS_PER_INVOICE} attachments per invoice`);
    }
    if (!this.storage.isConfigured()) throw new BadRequestException('File storage is not configured');
    const key = `${INVOICE_ATTACHMENTS_PREFIX}${invoiceId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { uploadUrl, key: finalKey } = await this.storage.getPresignedPutUrl(key, contentType);
    return { uploadUrl, key: finalKey };
  }

  async addAttachment(invoiceId: string, userId: string, role: UserRole, dto: AddInvoiceAttachmentDto) {
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can add attachments');
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { _count: { select: { attachments: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Not your invoice');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, invoice.projectId);
    }
    if (invoice.status !== 'draft' && invoice.status !== 'sent') {
      throw new BadRequestException('Attachments can only be added to draft or sent invoices');
    }
    if (invoice._count.attachments >= MAX_ATTACHMENTS_PER_INVOICE) {
      throw new BadRequestException(`Maximum ${MAX_ATTACHMENTS_PER_INVOICE} attachments per invoice`);
    }
    if (!dto.fileKey.startsWith(INVOICE_ATTACHMENTS_PREFIX + invoiceId + '/')) {
      throw new BadRequestException('Invalid file key for this invoice');
    }
    const attachment = await this.prisma.invoiceAttachment.create({
      data: {
        invoiceId,
        fileKey: dto.fileKey,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        size: dto.size,
      },
    });
    return attachment;
  }

  async listAttachments(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { attachments: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    await this.ensureInvoiceAccess(invoice.issuerUserId, invoice.recipientUserId, invoice.projectId, userId);
    const withUrls = await Promise.all(
      invoice.attachments.map(async (a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        createdAt: a.createdAt.toISOString(),
        downloadUrl: await this.storage.getSignedUrl(a.fileKey),
      })),
    );
    return { attachments: withUrls };
  }

  async deleteAttachment(attachmentId: string, userId: string, role: UserRole) {
    const attachment = await this.prisma.invoiceAttachment.findUnique({
      where: { id: attachmentId },
      include: { invoice: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.invoice.status === 'paid') {
      throw new BadRequestException('Cannot delete attachments from a paid invoice');
    }
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only issuer can delete attachments');
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const issuerAccountUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    if (attachment.invoice.issuerUserId !== issuerAccountUserId) throw new ForbiddenException('Not your invoice');
    if (vendorCtx && !vendorCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, attachment.invoice.projectId);
    }
    await this.prisma.invoiceAttachment.delete({ where: { id: attachmentId } });
    if (this.storage.isConfigured()) {
      await this.storage.deleteObject(attachment.fileKey).catch(() => {});
    }
    return { deleted: true };
  }

  async initiatePayment(invoiceId: string, userId: string, role: UserRole) {
    if (role !== 'company') throw new ForbiddenException('Only company (recipient) can pay');
    const companyCtx = await this.getCompanyAccountContext(userId);
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.recipientUserId !== companyCtx.accountOwnerId) throw new ForbiddenException('Not your invoice');
    if (!companyCtx.isMainUser) {
      await this.ensureProjectAssignedToSubUser(companyCtx.accountOwnerId, userId, invoice.projectId);
    }
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

  private async ensureInvoiceAccess(
    issuerUserId: string,
    recipientUserId: string,
    projectId: string,
    userId: string,
  ) {
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    if (companyCtx && recipientUserId === companyCtx.accountOwnerId) {
      if (!companyCtx.isMainUser) {
        await this.ensureProjectAssignedToSubUser(companyCtx.accountOwnerId, userId, projectId);
      }
      return;
    }
    const vendorCtx = await this.getVendorAccountContextOrNull(userId);
    if (vendorCtx && issuerUserId === vendorCtx.accountOwnerId) {
      if (!vendorCtx.isMainUser) {
        await this.ensureProjectAssignedToSubUser(vendorCtx.accountOwnerId, userId, projectId);
      }
      return;
    }
    if (issuerUserId !== userId && recipientUserId !== userId) {
      throw new ForbiddenException('Not your invoice');
    }
  }

  private async ensureProjectAssignedToSubUser(accountUserId: string, subUserId: string, projectId: string) {
    const assigned = await this.prisma.subUserProjectAssignment.findFirst({
      where: { accountUserId, subUserId, projectId },
      select: { id: true },
    });
    if (!assigned) {
      throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
  }

  private async getCompanyAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) {
      throw new ForbiddenException('Only company users can perform this action');
    }
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private async getCompanyAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) {
      throw new ForbiddenException('Only vendor users can perform this action');
    }
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }
}
