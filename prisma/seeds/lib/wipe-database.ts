import type { PrismaClient } from '@prisma/client';

function isPostgresUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('postgresql:') || url.startsWith('postgres:');
}

/**
 * Deletes all application data in FK-safe order. Does not drop schema or migrations.
 * Sub-users (mainUserId set) must be removed before parent account rows.
 *
 * On PostgreSQL, truncates from `users` with CASCADE first (seconds even for huge DBs).
 * Set `SEED_ROW_DELETE=1` to force slow per-table deleteMany instead.
 */
export async function wipeDatabase(prisma: PrismaClient): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (isPostgresUrl(dbUrl) && process.env.SEED_ROW_DELETE !== '1') {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
    return;
  }

  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.review.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoiceAttachment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.bookingRequest.deleteMany();
  await prisma.projectRole.deleteMany();
  await prisma.subUserProjectAssignment.deleteMany();
  await prisma.project.deleteMany();
  await prisma.availabilitySlot.deleteMany();
  await prisma.vendorEquipmentAvailability.deleteMany();
  await prisma.vendorEquipment.deleteMany();
  await prisma.portfolioItem.deleteMany();
  await prisma.individualProfile.deleteMany();
  await prisma.companyProfile.deleteMany();
  await prisma.vendorProfile.deleteMany();
  await prisma.otpSession.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { mainUserId: { not: null } } });
  await prisma.user.deleteMany();
}
