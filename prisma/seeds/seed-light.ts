/**
 * Small demo dataset — quick to run, easy to reason about.
 *
 *   npx ts-node prisma/seeds/seed-light.ts
 *   npm run prisma:seed:light
 *
 * All accounts:  Test@1234
 *
 *   admin@claapo.test
 *   company1@claapo.test
 *   freelancer1@claapo.test, freelancer2@claapo.test
 *   vendor1@claapo.test
 */
import {
  PrismaClient,
  UserRole,
  VendorType,
  SlotStatus,
  ProjectStatus,
  BookingStatus,
  InvoiceStatus,
  MessageType,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { wipeDatabase } from './lib/wipe-database';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'Test@1234';

async function main() {
  const t0 = Date.now();
  console.log('Wiping existing data...');
  await wipeDatabase(prisma);

  console.log('Hashing password...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  const adminId = randomUUID();
  const companyId = randomUUID();
  const freelancer1Id = randomUUID();
  const freelancer2Id = randomUUID();
  const vendorId = randomUUID();

  const project1Id = randomUUID();
  const project2Id = randomUUID();
  const role1Id = randomUUID();
  const role2Id = randomUUID();
  const role3Id = randomUUID();

  const equipment1Id = randomUUID();

  const booking1Id = randomUUID();
  const booking2Id = randomUUID();
  const booking3Id = randomUUID();

  const conv1Id = randomUUID();
  const invoice1Id = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        email: 'admin@claapo.test',
        phone: '+919000000001',
        passwordHash,
        role: UserRole.admin,
        isVerified: true,
        isActive: true,
      },
      {
        id: companyId,
        email: 'company1@claapo.test',
        phone: '+919000000002',
        passwordHash,
        role: UserRole.company,
        isVerified: true,
        isActive: true,
      },
      {
        id: freelancer1Id,
        email: 'freelancer1@claapo.test',
        phone: '+919000000003',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
      },
      {
        id: freelancer2Id,
        email: 'freelancer2@claapo.test',
        phone: '+919000000004',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
      },
      {
        id: vendorId,
        email: 'vendor1@claapo.test',
        phone: '+919000000005',
        passwordHash,
        role: UserRole.vendor,
        isVerified: true,
        isActive: true,
      },
    ],
  });

  const now = new Date();
  const start1 = new Date(now);
  start1.setDate(start1.getDate() - 7);
  start1.setHours(0, 0, 0, 0);
  const end1 = new Date(start1);
  end1.setDate(end1.getDate() + 21);

  const start2 = new Date(now);
  start2.setDate(start2.getDate() + 14);
  start2.setHours(0, 0, 0, 0);
  const end2 = new Date(start2);
  end2.setDate(end2.getDate() + 30);

  const ratePaise = 50_000_00; // ₹50,000/day

  await prisma.individualProfile.createMany({
    data: [
      {
        userId: freelancer1Id,
        displayName: 'Riya Sharma',
        bio: 'DOP based in Mumbai.',
        skills: ['DOP', 'Camera Operator'],
        genre: 'Drama',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        lat: 19.076,
        lng: 72.8777,
        dailyBudget: ratePaise,
        isAvailable: true,
        avatarKey: 'https://i.pravatar.cc/200?img=12',
      },
      {
        userId: freelancer2Id,
        displayName: 'Arjun Verma',
        bio: 'Sound engineer.',
        skills: ['Sound Engineer'],
        genre: 'Documentary',
        locationCity: 'Bangalore',
        locationState: 'Karnataka',
        lat: 12.9716,
        lng: 77.5946,
        dailyBudget: 35_000_00,
        isAvailable: true,
        avatarKey: 'https://i.pravatar.cc/200?img=33',
      },
    ],
  });

  await prisma.companyProfile.create({
    data: {
      userId: companyId,
      companyName: 'Demo Production House',
      companyType: 'Production House',
      locationCity: 'Mumbai',
      locationState: 'Maharashtra',
      bio: 'Demo company for local testing.',
      gstNumber: '27AAAAA0000A1Z5',
      panNumber: 'AAAAA0000A',
      isGstVerified: true,
      logoKey: 'https://placehold.co/200x200/3B5BDB/ffffff?text=DP',
    },
  });

  await prisma.vendorProfile.create({
    data: {
      userId: vendorId,
      companyName: 'Demo Cine Rentals',
      vendorType: VendorType.equipment,
      vendorServiceCategory: 'Camera & lighting packages',
      locationCity: 'Mumbai',
      locationState: 'Maharashtra',
      bio: 'Camera and grip rentals.',
      gstNumber: '27BBBBB0000B1Z5',
      isGstVerified: true,
      logoKey: 'https://placehold.co/200x200/E94560/ffffff?text=DCR',
    },
  });

  await prisma.vendorEquipment.create({
    data: {
      id: equipment1Id,
      vendorUserId: vendorId,
      name: 'Sony FX6 Kit',
      description: 'Camera body, lenses, media.',
      imageUrl: 'https://placehold.co/400x300/1a1a2e/e94560?text=FX6',
      currentCity: 'Mumbai',
      dailyBudget: 15_000_00,
    },
  });

  for (let d = -3; d <= 14; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    date.setHours(0, 0, 0, 0);
    const status: SlotStatus =
      d < 0 ? SlotStatus.past_work : d <= 2 ? SlotStatus.booked : SlotStatus.available;
    await prisma.availabilitySlot.create({
      data: { userId: freelancer1Id, date, status, notes: null },
    });
  }

  await prisma.project.createMany({
    data: [
      {
        id: project1Id,
        companyUserId: companyId,
        title: 'Monsoon Short — Demo',
        productionHouseName: 'Demo Production House',
        description: 'A small demo shoot in Mumbai.',
        startDate: start1,
        endDate: end1,
        locationCity: 'Mumbai',
        budget: 25_00_000_00,
        status: ProjectStatus.active,
        shootDates: [start1, new Date(start1.getTime() + 86400000)],
        shootLocations: ['Film City'],
      },
      {
        id: project2Id,
        companyUserId: companyId,
        title: 'Commercial — Demo Q2',
        productionHouseName: 'Demo Production House',
        description: 'Upcoming TVC.',
        startDate: start2,
        endDate: end2,
        locationCity: 'Bangalore',
        budget: 40_00_000_00,
        status: ProjectStatus.open,
      },
    ],
  });

  await prisma.projectRole.createMany({
    data: [
      { id: role1Id, projectId: project1Id, roleName: 'DOP', qty: 1, rateMin: 45_000_00, rateMax: 60_000_00 },
      { id: role2Id, projectId: project1Id, roleName: 'Sound Engineer', qty: 1, rateMin: 25_000_00, rateMax: 40_000_00 },
      { id: role3Id, projectId: project2Id, roleName: 'DOP', qty: 1, rateMin: 50_000_00, rateMax: 70_000_00 },
    ],
  });

  await prisma.bookingRequest.createMany({
    data: [
      {
        id: booking1Id,
        projectId: project1Id,
        requesterUserId: companyId,
        targetUserId: freelancer1Id,
        projectRoleId: role1Id,
        status: BookingStatus.locked,
        rateOffered: ratePaise,
        message: 'We would love you as DOP on Monsoon Short.',
        respondedAt: new Date(now.getTime() - 86400000 * 5),
        lockedAt: new Date(now.getTime() - 86400000 * 3),
        shootDates: [start1],
        shootLocations: ['Film City'],
      },
      {
        id: booking2Id,
        projectId: project1Id,
        requesterUserId: companyId,
        targetUserId: freelancer2Id,
        projectRoleId: role2Id,
        status: BookingStatus.accepted,
        rateOffered: 32_000_00,
        message: 'Sound for Monsoon Short.',
        respondedAt: new Date(now.getTime() - 86400000 * 4),
      },
      {
        id: booking3Id,
        projectId: project1Id,
        requesterUserId: companyId,
        targetUserId: vendorId,
        vendorEquipmentId: equipment1Id,
        status: BookingStatus.accepted,
        rateOffered: 15_000_00,
        message: 'FX6 kit for week one.',
        respondedAt: new Date(now.getTime() - 86400000 * 2),
      },
    ],
  });

  const [convA, convB] = [companyId, freelancer1Id].sort();
  await prisma.conversation.create({
    data: {
      id: conv1Id,
      projectId: project1Id,
      participantA: convA,
      participantB: convB,
      lastMessageAt: now,
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv1Id,
        senderId: companyId,
        type: MessageType.text,
        content: 'Hi Riya — confirming call time 7 AM Monday.',
        isRead: true,
        createdAt: new Date(now.getTime() - 86400000 * 2),
      },
      {
        conversationId: conv1Id,
        senderId: freelancer1Id,
        type: MessageType.text,
        content: 'Sounds good. I will bring the full camera package.',
        isRead: true,
        createdAt: new Date(now.getTime() - 86400000 * 2 + 3600000),
      },
      {
        conversationId: conv1Id,
        senderId: companyId,
        type: MessageType.text,
        content: 'Perfect, see you on set.',
        isRead: false,
        createdAt: new Date(now.getTime() - 86400000),
      },
    ],
  });

  const invAmount = 50_000_00;
  const invGst = Math.round(invAmount * 0.18);
  await prisma.invoice.create({
    data: {
      id: invoice1Id,
      projectId: project1Id,
      issuerUserId: freelancer1Id,
      recipientUserId: companyId,
      invoiceNumber: 'INV-DEMO-000001',
      amount: invAmount,
      gstAmount: invGst,
      totalAmount: invAmount + invGst,
      status: InvoiceStatus.sent,
      dueDate: new Date(now.getTime() + 86400000 * 14),
      lineItems: {
        create: [
          {
            description: 'Monsoon Short — DOP fees (week 1)',
            quantity: new Prisma.Decimal(1),
            unitPrice: invAmount,
            amount: invAmount,
          },
        ],
      },
    },
  });

  await prisma.review.create({
    data: {
      bookingId: booking1Id,
      reviewerUserId: companyId,
      revieweeUserId: freelancer1Id,
      rating: 5,
      text: 'Excellent collaborator — punctual and creative.',
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: freelancer1Id,
        type: 'booking_locked',
        title: 'Booking confirmed',
        body: 'Your booking for Monsoon Short is locked.',
        readAt: null,
      },
      {
        userId: companyId,
        type: 'invoice_sent',
        title: 'Invoice received',
        body: 'You have a new invoice from Riya Sharma.',
        readAt: null,
      },
    ],
  });

  console.log(`\nLight seed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\nAll accounts use password: ' + DEFAULT_PASSWORD);
  console.log('  admin@claapo.test');
  console.log('  company1@claapo.test');
  console.log('  freelancer1@claapo.test');
  console.log('  freelancer2@claapo.test');
  console.log('  vendor1@claapo.test');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
