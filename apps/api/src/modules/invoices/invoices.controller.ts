import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { AddInvoiceAttachmentDto } from './dto/add-invoice-attachment.dto';
import { DeclineInvoiceDto } from './dto/decline-invoice.dto';

@ApiTags('invoices')
@Controller('invoices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Create invoice for project' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoicesService.create(user.id, user.role, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List own invoices (paginated). Optional issuedOn=YYYY-MM-DD filters by invoice created date (UTC day).' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('issuedOn') issuedOn?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.invoicesService.list(user.id, parseInt(page ?? '1', 10), parseInt(limit ?? '20', 10), issuedOn, projectId);
  }

  @Get(':id/attachments/upload-url')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Get presigned URL to upload an attachment' })
  getAttachmentUploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('contentType') contentType?: string,
  ) {
    return this.invoicesService.getAttachmentUploadUrl(id, user.id, user.role, contentType);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List invoice attachments with download URLs' })
  listAttachments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.listAttachments(id, user.id);
  }

  @Post(':id/attachments')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Register an attachment after upload' })
  addAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddInvoiceAttachmentDto,
  ) {
    return this.invoicesService.addAttachment(id, user.id, user.role, dto);
  }

  @Delete('attachments/:attachmentId')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Delete an invoice attachment' })
  deleteAttachment(@CurrentUser() user: AuthUser, @Param('attachmentId') attachmentId: string) {
    return this.invoicesService.deleteAttachment(attachmentId, user.id, user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice detail + line items + issuer/recipient metadata + attachments' })
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.getOne(id, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Update draft invoice' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, user.id, user.role, dto);
  }

  @Post(':id/send')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Send invoice to company' })
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.send(id, user.id, user.role);
  }

  @Patch(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('individual', 'vendor')
  @ApiOperation({ summary: 'Cancel draft or sent invoice' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.cancel(id, user.id, user.role);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get PDF key or placeholder' })
  getPdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.getPdfUrl(id, user.id);
  }

  @Post(':id/pay')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Initiate Razorpay payment' })
  initiatePay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.initiatePayment(id, user.id, user.role);
  }

  @Patch(':id/mark-paid')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Mark invoice as paid (recipient / manual confirmation)' })
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoicesService.markAsPaid(id, user.id);
  }

  @Patch(':id/decline')
  @UseGuards(RolesGuard)
  @Roles('company')
  @ApiOperation({ summary: 'Decline invoice as recipient with optional reason' })
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DeclineInvoiceDto,
  ) {
    return this.invoicesService.declineAsRecipient(id, user.id, dto.reason);
  }
}
