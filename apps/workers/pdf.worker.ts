import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import puppeteer from 'puppeteer';
import { createRedisConnection } from './redis';
import { QUEUE_PDF, type PdfJobPayload } from './shared';

const connection = createRedisConnection();
const prisma = new PrismaClient();
const bucket = process.env.AWS_S3_BUCKET ?? '';
const region = process.env.AWS_REGION ?? 'ap-south-1';
const s3 = bucket ? new S3Client({ region }) : null;

function buildInvoiceHtml(invoice: {
  invoiceNumber: string;
  totalAmount: number;
  amount: number;
  gstAmount: number;
  dueDate: Date | null;
  lineItems: Array<{ description: string; quantity: unknown; unitPrice: number; amount: number }>;
  project: { title: string };
  issuer: { individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
  recipient: { individualProfile?: { displayName: string } | null; companyProfile?: { companyName: string } | null; vendorProfile?: { companyName: string } | null };
}): string {
  const issuerName =
    invoice.issuer.individualProfile?.displayName ??
    invoice.issuer.vendorProfile?.companyName ??
    invoice.issuer.companyProfile?.companyName ??
    '—';
  const recipientName =
    invoice.recipient.companyProfile?.companyName ??
    invoice.recipient.individualProfile?.displayName ??
    invoice.recipient.vendorProfile?.companyName ??
    '—';
  const formatPaise = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
  const rows = invoice.lineItems
    .map(
      (li) =>
        `<tr><td>${escapeHtml(li.description)}</td><td>${li.quantity}</td><td>${formatPaise(li.unitPrice)}</td><td>${formatPaise(li.amount)}</td></tr>`,
    )
    .join('');
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
  .header { display: flex; justify-content: space-between; margin-bottom: 2rem; }
  .totals { text-align: right; margin-top: 1rem; }
  .totals p { margin: 4px 0; }
</style></head>
<body>
  <div class="header">
    <div><h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1><p>Project: ${escapeHtml(invoice.project.title)}</p></div>
    <div>${invoice.dueDate ? `<p>Due: ${invoice.dueDate.toISOString().slice(0, 10)}</p>` : ''}</div>
  </div>
  <p><strong>From:</strong> ${escapeHtml(issuerName)}</p>
  <p><strong>To:</strong> ${escapeHtml(recipientName)}</p>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <p>Subtotal: ${formatPaise(invoice.amount)}</p>
    <p>GST (18%): ${formatPaise(invoice.gstAmount)}</p>
    <p><strong>Total: ${formatPaise(invoice.totalAmount)}</strong></p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const worker = new Worker<PdfJobPayload>(
  QUEUE_PDF,
  async (job) => {
    if (job.name !== 'generate') return;
    const { invoiceId } = job.data;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        project: { select: { title: true } },
        issuer: {
          select: {
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        recipient: {
          select: {
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
      },
    });
    if (!invoice || invoice.status !== 'sent') return;

    const html = buildInvoiceHtml(invoice as any);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
      await browser.close();

      const key = `invoices/${invoiceId}/${invoice.invoiceNumber}.pdf`;
      if (s3 && bucket) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: pdfBuffer,
            ContentType: 'application/pdf',
          }),
        );
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { pdfKey: key },
        });
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[PDF Worker] Dev: would save PDF to S3 key ${key}`);
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: { pdfKey: key },
          });
        } else {
          throw new Error('AWS_S3_BUCKET not set');
        }
      }
    } finally {
      await browser.close();
    }
  },
  {
    connection: connection as any,
    concurrency: 2,
  },
);

worker.on('completed', (job) => console.log(`[PDF] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[PDF] Job ${job?.id} failed:`, err.message));

async function close() {
  await worker.close();
  connection.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
