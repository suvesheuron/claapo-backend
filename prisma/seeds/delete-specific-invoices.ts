/**
 * One-off cleanup script — deletes two specific invoices that were issued in
 * production by mistake / test data:
 *
 *   1. INV-0001 — normal invoice from gmstudio@claapo.test → momentintime@claapo.test
 *   2. INV-0002 — offline invoice recorded by momentintime@claapo.test for
 *                 "Ashmita Mogha" (Costume Assistant)
 *
 * Both invoices are paid in production, so the existing PATCH /invoices/:id/cancel
 * endpoint won't touch them (it only allows draft/sent → cancelled). This
 * script does a hard delete with cascading cleanup of line items, attachments,
 * and best-effort S3 file removal.
 *
 *   DRY_RUN=1 npx ts-node prisma/seeds/delete-specific-invoices.ts
 *             npx ts-node prisma/seeds/delete-specific-invoices.ts
 *
 * The DRY_RUN flag lists what would be deleted without making any changes —
 * always run dry first against the target environment to verify the matches.
 */

import 'dotenv/config';
import { PrismaClient, type Invoice, type InvoiceAttachment, type InvoiceLineItem } from '@prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const COMPANY_EMAIL = 'momentintime@claapo.test';
const SENDER_EMAIL = 'gmstudio@claapo.test';

const NORMAL_INVOICE_NUMBER = 'INV-0001';
const OFFLINE_INVOICE_NUMBER = 'INV-0002';
const OFFLINE_BILLING_NAME_LIKE = 'Ashmita Mogha';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

interface InvoiceWithChildren extends Invoice {
  lineItems: InvoiceLineItem[];
  attachments: InvoiceAttachment[];
}

const prisma = new PrismaClient();

function makeS3Client(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.AWS_S3_BUCKET ?? '';
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  const hasCreds = !!process.env.AWS_ACCESS_KEY_ID || !!process.env.AWS_PROFILE;
  if (!bucket || !hasCreds) return null;
  return {
    client: new S3Client({
      region,
      ...(process.env.AWS_ENDPOINT && { endpoint: process.env.AWS_ENDPOINT }),
    }),
    bucket,
  };
}

function describeInvoice(inv: InvoiceWithChildren): string {
  const offline = inv.recordedOfflineByCompany ? ' [OFFLINE]' : '';
  const offlineLabel = inv.offlineBillingName?.trim() ? ` for "${inv.offlineBillingName.trim()}"` : '';
  return `${inv.invoiceNumber}${offline}${offlineLabel} · ₹${(inv.totalAmount / 100).toLocaleString('en-IN')} · status=${inv.status} · id=${inv.id}`;
}

async function findNormalInvoice(): Promise<InvoiceWithChildren | null> {
  const sender = await prisma.user.findUnique({ where: { email: SENDER_EMAIL } });
  const company = await prisma.user.findUnique({ where: { email: COMPANY_EMAIL } });
  if (!sender) {
    console.warn(`  ! sender user not found: ${SENDER_EMAIL}`);
    return null;
  }
  if (!company) {
    console.warn(`  ! company user not found: ${COMPANY_EMAIL}`);
    return null;
  }
  // Prefer the main account ids (the schema stores invoices against the
  // account-owner, not sub-users). Resolve once and use everywhere below.
  const senderOwnerId = sender.mainUserId ?? sender.id;
  const companyOwnerId = company.mainUserId ?? company.id;

  const matches = await prisma.invoice.findMany({
    where: {
      invoiceNumber: NORMAL_INVOICE_NUMBER,
      issuerUserId: senderOwnerId,
      recipientUserId: companyOwnerId,
      recordedOfflineByCompany: false,
    },
    include: { lineItems: true, attachments: true },
    orderBy: { createdAt: 'desc' },
  });

  if (matches.length === 0) {
    console.warn(`  ! no normal invoice ${NORMAL_INVOICE_NUMBER} found from ${SENDER_EMAIL} → ${COMPANY_EMAIL}`);
    return null;
  }
  if (matches.length > 1) {
    console.warn(`  ! ${matches.length} normal invoices match — refusing to guess. Inspect manually:`);
    for (const m of matches) console.warn(`      • ${describeInvoice(m)}`);
    return null;
  }
  return matches[0];
}

async function findOfflineInvoice(): Promise<InvoiceWithChildren | null> {
  const company = await prisma.user.findUnique({ where: { email: COMPANY_EMAIL } });
  if (!company) {
    console.warn(`  ! company user not found: ${COMPANY_EMAIL}`);
    return null;
  }
  const companyOwnerId = company.mainUserId ?? company.id;

  // Offline invoices recorded by the company set issuer = recipient = company
  // account owner. Match by all three fields plus the billing-name hint to
  // avoid catching unrelated offline rows.
  const matches = await prisma.invoice.findMany({
    where: {
      invoiceNumber: OFFLINE_INVOICE_NUMBER,
      issuerUserId: companyOwnerId,
      recipientUserId: companyOwnerId,
      recordedOfflineByCompany: true,
      offlineBillingName: { contains: OFFLINE_BILLING_NAME_LIKE, mode: 'insensitive' },
    },
    include: { lineItems: true, attachments: true },
    orderBy: { createdAt: 'desc' },
  });

  if (matches.length === 0) {
    console.warn(`  ! no offline invoice ${OFFLINE_INVOICE_NUMBER} for "${OFFLINE_BILLING_NAME_LIKE}" found under ${COMPANY_EMAIL}`);
    return null;
  }
  if (matches.length > 1) {
    console.warn(`  ! ${matches.length} offline invoices match — refusing to guess. Inspect manually:`);
    for (const m of matches) console.warn(`      • ${describeInvoice(m)}`);
    return null;
  }
  return matches[0];
}

async function deleteS3Objects(
  invoice: InvoiceWithChildren,
  s3: ReturnType<typeof makeS3Client>,
): Promise<void> {
  if (!s3) {
    console.log('    ↳ S3 not configured (no AWS_S3_BUCKET / credentials) — skipping object cleanup');
    return;
  }
  const keys: string[] = [];
  if (invoice.pdfKey) keys.push(invoice.pdfKey);
  for (const att of invoice.attachments) keys.push(att.fileKey);
  if (keys.length === 0) {
    console.log('    ↳ no S3 keys associated with this invoice');
    return;
  }
  for (const key of keys) {
    try {
      await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
      console.log(`    ✓ s3://${s3.bucket}/${key}`);
    } catch (err) {
      console.warn(`    ! failed to delete s3://${s3.bucket}/${key}: ${(err as Error).message}`);
    }
  }
}

async function deleteInvoice(invoice: InvoiceWithChildren, s3: ReturnType<typeof makeS3Client>): Promise<void> {
  console.log(`\n  → deleting ${describeInvoice(invoice)}`);
  console.log(`    line items: ${invoice.lineItems.length}, attachments: ${invoice.attachments.length}`);

  if (DRY_RUN) {
    console.log('    [DRY_RUN] would cascade-delete line items + attachments and remove S3 keys');
    return;
  }

  // The invoice row delete cascades to line items + attachment DB rows
  // (declared with onDelete: Cascade in schema.prisma). Wrap in a tx so a
  // failure leaves the row intact rather than half-cleaned.
  await prisma.$transaction(async (tx) => {
    await tx.invoice.delete({ where: { id: invoice.id } });
  });
  console.log('    ✓ row + cascaded children removed from DB');

  // S3 cleanup is best-effort and runs after the DB delete. Failures here
  // leave orphan objects but never resurrect the invoice.
  await deleteS3Objects(invoice, s3);
}

async function main(): Promise<void> {
  console.log(`Invoice cleanup — DRY_RUN=${DRY_RUN ? 'YES' : 'NO'}`);
  console.log(`  company : ${COMPANY_EMAIL}`);
  console.log(`  sender  : ${SENDER_EMAIL}`);
  console.log('  targets :');
  console.log(`    • ${NORMAL_INVOICE_NUMBER}  (normal, sender → company)`);
  console.log(`    • ${OFFLINE_INVOICE_NUMBER}  (offline, "${OFFLINE_BILLING_NAME_LIKE}", recorded by company)`);

  const s3 = makeS3Client();
  console.log(`  storage : ${s3 ? `s3://${s3.bucket}` : 'not configured (S3 cleanup will be skipped)'}\n`);

  const normal = await findNormalInvoice();
  const offline = await findOfflineInvoice();

  if (!normal && !offline) {
    console.log('\nNothing to do.');
    return;
  }

  console.log('\nMatched:');
  if (normal) console.log(`  ✓ normal  → ${describeInvoice(normal)}`);
  if (offline) console.log(`  ✓ offline → ${describeInvoice(offline)}`);

  if (normal) await deleteInvoice(normal, s3);
  if (offline) await deleteInvoice(offline, s3);

  console.log(`\n${DRY_RUN ? 'Dry run complete — no changes written.' : 'Cleanup complete.'}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('\nScript failed:', err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
