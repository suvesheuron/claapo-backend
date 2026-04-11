/**
 * Small demo dataset — quick to run, easy to reason about.
 *
 *   npx ts-node prisma/seeds/seed-light.ts
 *   npm run prisma:seed:light
 *
 * All accounts password:  Test@1234
 *
 *   admin@claapo.test
 *   company1@claapo.test        (Demo Production House)
 *   company2@claapo.test        (Sunrise Studios)
 *   subuser1@claapo.test        (producer under Demo Production House)
 *   freelancer1@claapo.test     (Riya Sharma — DOP, Mumbai)
 *   freelancer2@claapo.test     (Arjun Verma — Sound, Bangalore)
 *   freelancer3@claapo.test     (Priya Patel — Editor, Mumbai)
 *   freelancer4@claapo.test     (Karan Mehta — Gaffer, Delhi)
 *   vendor1@claapo.test         (Demo Cine Rentals — equipment)
 *   vendor2@claapo.test         (Reel Catering Co — catering)
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

function dayOffset(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function main() {
  const t0 = Date.now();
  console.log('Wiping existing data...');
  await wipeDatabase(prisma);

  console.log('Hashing password...');
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

  // ---------------------------------------------------------------------------
  // IDs
  // ---------------------------------------------------------------------------
  const adminId = randomUUID();
  const company1Id = randomUUID();
  const company2Id = randomUUID();
  const subUser1Id = randomUUID();
  const freelancer1Id = randomUUID();
  const freelancer2Id = randomUUID();
  const freelancer3Id = randomUUID();
  const freelancer4Id = randomUUID();
  const vendor1Id = randomUUID();
  const vendor2Id = randomUUID();

  const project1Id = randomUUID();
  const project2Id = randomUUID();
  const project3Id = randomUUID();

  const role1Id = randomUUID();
  const role2Id = randomUUID();
  const role3Id = randomUUID();
  const role4Id = randomUUID();
  const role5Id = randomUUID();
  const role6Id = randomUUID();

  const equipment1Id = randomUUID();
  const equipment2Id = randomUUID();

  const booking1Id = randomUUID();
  const booking2Id = randomUUID();
  const booking3Id = randomUUID();
  const booking4Id = randomUUID();
  const booking5Id = randomUUID();
  const booking6Id = randomUUID();
  const booking7Id = randomUUID();

  const conv1Id = randomUUID();
  const conv2Id = randomUUID();

  const invoice1Id = randomUUID();
  const invoice2Id = randomUUID();
  const invoice3Id = randomUUID();

  const contract1Id = randomUUID();

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
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
        id: company1Id,
        email: 'company1@claapo.test',
        phone: '+919000000002',
        passwordHash,
        role: UserRole.company,
        isVerified: true,
        isActive: true,
        notificationPreferences: { email: true, push: true, sms: false },
      },
      {
        id: company2Id,
        email: 'company2@claapo.test',
        phone: '+919000000003',
        passwordHash,
        role: UserRole.company,
        isVerified: true,
        isActive: true,
      },
      {
        id: subUser1Id,
        email: 'subuser1@claapo.test',
        phone: '+919000000004',
        passwordHash,
        role: UserRole.company,
        mainUserId: company1Id,
        isVerified: true,
        isActive: true,
      },
      {
        id: freelancer1Id,
        email: 'freelancer1@claapo.test',
        phone: '+919000000005',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
        fcmToken: 'demo-fcm-token-freelancer1',
      },
      {
        id: freelancer2Id,
        email: 'freelancer2@claapo.test',
        phone: '+919000000006',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
      },
      {
        id: freelancer3Id,
        email: 'freelancer3@claapo.test',
        phone: '+919000000007',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
      },
      {
        id: freelancer4Id,
        email: 'freelancer4@claapo.test',
        phone: '+919000000008',
        passwordHash,
        role: UserRole.individual,
        isVerified: true,
        isActive: true,
      },
      {
        id: vendor1Id,
        email: 'vendor1@claapo.test',
        phone: '+919000000009',
        passwordHash,
        role: UserRole.vendor,
        isVerified: true,
        isActive: true,
      },
      {
        id: vendor2Id,
        email: 'vendor2@claapo.test',
        phone: '+919000000010',
        passwordHash,
        role: UserRole.vendor,
        isVerified: true,
        isActive: true,
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Individual profiles
  // ---------------------------------------------------------------------------
  await prisma.individualProfile.createMany({
    data: [
      {
        userId: freelancer1Id,
        displayName: 'Riya Sharma',
        bio: 'DOP based in Mumbai. 8 years shooting features and commercials.',
        aboutMe:
          'I specialise in naturalistic lighting and handheld drama. Trained at FTII, currently repped by Storm Reps.',
        skills: ['DOP', 'Camera Operator', 'Steadicam'],
        genres: ['Drama', 'Commercial', 'Music Video'],
        address: '12, Linking Road, Bandra West',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        lat: 19.076,
        lng: 72.8777,
        dailyBudget: 50_000_00,
        isAvailable: true,
        avatarKey: 'https://i.pravatar.cc/200?img=12',
        showreelKey: 'https://vimeo.com/000000001',
        imdbUrl: 'https://www.imdb.com/name/nm0000001/',
        instagramUrl: 'https://instagram.com/riya.dop',
        linkedinUrl: 'https://linkedin.com/in/riyasharma',
        vimeoUrl: 'https://vimeo.com/riyasharma',
        profileScore: 92,
        panNumber: 'ABCPS1234A',
        bankAccountName: 'Riya Sharma',
        bankAccountNumber: '1234567890',
        ifscCode: 'HDFC0000123',
        bankName: 'HDFC Bank',
      },
      {
        userId: freelancer2Id,
        displayName: 'Arjun Verma',
        bio: 'Sound engineer with 6 years on set. Boom + radios.',
        aboutMe: 'Location sound specialist, owns full kit (Sound Devices 833 + DPA).',
        skills: ['Sound Engineer', 'Boom Operator'],
        genres: ['Documentary', 'Drama'],
        address: 'Indiranagar 1st Stage',
        locationCity: 'Bangalore',
        locationState: 'Karnataka',
        lat: 12.9716,
        lng: 77.5946,
        dailyBudget: 35_000_00,
        isAvailable: true,
        avatarKey: 'https://i.pravatar.cc/200?img=33',
        profileScore: 78,
        panNumber: 'ABCPA2345B',
      },
      {
        userId: freelancer3Id,
        displayName: 'Priya Patel',
        bio: 'Editor — Avid & Premiere. Narrative and branded content.',
        aboutMe: 'Turned around a 26-ep series in 4 months. Fast rough cuts, patient with notes.',
        skills: ['Editor', 'Avid', 'Premiere Pro'],
        genres: ['Drama', 'Branded'],
        address: 'Andheri West',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        lat: 19.1197,
        lng: 72.8468,
        dailyBudget: 28_000_00,
        isAvailable: true,
        avatarKey: 'https://i.pravatar.cc/200?img=47',
        profileScore: 85,
      },
      {
        userId: freelancer4Id,
        displayName: 'Karan Mehta',
        bio: 'Gaffer / Chief Lighting Technician.',
        skills: ['Gaffer', 'Lighting'],
        genres: ['Commercial', 'Music Video'],
        locationCity: 'Delhi',
        locationState: 'Delhi',
        lat: 28.6139,
        lng: 77.209,
        dailyBudget: 22_000_00,
        isAvailable: false,
        profileScore: 60,
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Company profiles
  // ---------------------------------------------------------------------------
  await prisma.companyProfile.createMany({
    data: [
      {
        userId: company1Id,
        companyName: 'Demo Production House',
        companyType: 'Production House',
        skills: ['TVC', 'Short Film', 'Music Video'],
        website: 'https://demoproduction.test',
        address: 'Film City Road, Goregaon East',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        bio: 'Demo company for local testing.',
        aboutUs:
          'Mumbai-based production house founded in 2016. We produce commercials, short films and music videos for Indian and international brands.',
        gstNumber: '27AAAAA0000A1Z5',
        panNumber: 'AAAAA0000A',
        isGstVerified: true,
        logoKey: 'https://placehold.co/200x200/3B5BDB/ffffff?text=DP',
        instagramUrl: 'https://instagram.com/demoproduction',
        linkedinUrl: 'https://linkedin.com/company/demoproduction',
        bankAccountName: 'Demo Production House Pvt Ltd',
        bankAccountNumber: '9876543210',
        ifscCode: 'ICIC0000456',
        bankName: 'ICICI Bank',
      },
      {
        userId: company2Id,
        companyName: 'Sunrise Studios',
        companyType: 'Studio',
        skills: ['Feature Film', 'Documentary'],
        website: 'https://sunrise.test',
        locationCity: 'Delhi',
        locationState: 'Delhi',
        bio: 'Documentary and feature-focused studio.',
        aboutUs: 'Delhi-based documentary studio telling South Asian stories since 2012.',
        gstNumber: '07CCCCC0000C1Z5',
        panNumber: 'CCCCC0000C',
        isGstVerified: true,
        logoKey: 'https://placehold.co/200x200/845EC2/ffffff?text=SS',
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Vendor profiles
  // ---------------------------------------------------------------------------
  await prisma.vendorProfile.createMany({
    data: [
      {
        userId: vendor1Id,
        companyName: 'Demo Cine Rentals',
        vendorType: VendorType.equipment,
        vendorServiceCategory: 'Camera & lighting packages',
        address: 'Aram Nagar, Versova',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        bio: 'Camera and grip rentals.',
        aboutUs:
          'Full-service camera and grip rental house. Sony, ARRI and RED bodies plus full lighting and grip kits.',
        gstNumber: '27BBBBB0000B1Z5',
        panNumber: 'BBBBB0000B',
        isGstVerified: true,
        logoKey: 'https://placehold.co/200x200/E94560/ffffff?text=DCR',
        website: 'https://democinerentals.test',
        bankAccountName: 'Demo Cine Rentals LLP',
        bankAccountNumber: '5566778899',
        ifscCode: 'HDFC0000999',
        bankName: 'HDFC Bank',
      },
      {
        userId: vendor2Id,
        companyName: 'Reel Catering Co',
        vendorType: VendorType.catering,
        vendorServiceCategory: 'On-set catering',
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
        bio: 'Catering for up to 200 crew.',
        aboutUs: 'North-Indian and South-Indian menus, breakfast-to-dinner service on set.',
        gstNumber: '27DDDDD0000D1Z5',
        isGstVerified: true,
        logoKey: 'https://placehold.co/200x200/00C9A7/ffffff?text=RCC',
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Vendor equipment + availability
  // ---------------------------------------------------------------------------
  await prisma.vendorEquipment.createMany({
    data: [
      {
        id: equipment1Id,
        vendorUserId: vendor1Id,
        name: 'Sony FX6 Kit',
        description: 'Camera body, 4 x Sigma primes, 2 x V-mount, CFexpress media.',
        imageUrl: 'https://placehold.co/400x300/1a1a2e/e94560?text=FX6',
        currentCity: 'Mumbai',
        dailyBudget: 15_000_00,
      },
      {
        id: equipment2Id,
        vendorUserId: vendor1Id,
        name: 'ARRI SkyPanel S60-C',
        description: 'Full-colour LED soft light with flight case.',
        imageUrl: 'https://placehold.co/400x300/1a1a2e/ffcc29?text=SkyPanel',
        currentCity: 'Mumbai',
        dailyBudget: 6_000_00,
      },
    ],
  });

  await prisma.vendorEquipmentAvailability.createMany({
    data: [
      {
        equipmentId: equipment1Id,
        locationCity: 'Mumbai',
        availableFrom: dayOffset(-30),
        availableTo: dayOffset(60),
        notes: 'Available for long-form bookings',
      },
      {
        equipmentId: equipment2Id,
        locationCity: 'Mumbai',
        availableFrom: dayOffset(0),
        availableTo: dayOffset(30),
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Portfolio items
  // ---------------------------------------------------------------------------
  await prisma.portfolioItem.createMany({
    data: [
      {
        userId: freelancer1Id,
        title: 'Still from "Monsoon Nights"',
        imageKey: 'https://placehold.co/800x600/111/eee?text=Monsoon+Nights',
        category: 'Feature',
        sortOrder: 1,
      },
      {
        userId: freelancer1Id,
        title: 'Kwality TVC — Director\'s Cut',
        imageKey: 'https://placehold.co/800x600/222/eee?text=Kwality+TVC',
        category: 'Commercial',
        sortOrder: 2,
      },
      {
        userId: freelancer3Id,
        title: 'Docuseries Trailer',
        imageKey: 'https://placehold.co/800x600/333/eee?text=Docuseries',
        category: 'Trailer',
        sortOrder: 1,
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Availability slots
  // ---------------------------------------------------------------------------
  const slotRows: Prisma.AvailabilitySlotCreateManyInput[] = [];
  for (let d = -5; d <= 20; d++) {
    const date = dayOffset(d);
    const status: SlotStatus =
      d < 0 ? SlotStatus.past_work : d <= 2 ? SlotStatus.booked : SlotStatus.available;
    slotRows.push({ userId: freelancer1Id, date, status });
    if (d >= 0 && d <= 10) {
      slotRows.push({ userId: freelancer2Id, date, status: SlotStatus.available });
    }
  }
  slotRows.push({ userId: freelancer4Id, date: dayOffset(3), status: SlotStatus.blocked, notes: 'Out of town' });
  await prisma.availabilitySlot.createMany({ data: slotRows });

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------
  const p1Start = dayOffset(-7);
  const p1End = dayOffset(14);
  const p2Start = dayOffset(21);
  const p2End = dayOffset(51);
  const p3Start = dayOffset(45);
  const p3End = dayOffset(90);

  await prisma.project.createMany({
    data: [
      {
        id: project1Id,
        companyUserId: company1Id,
        title: 'Monsoon Short — Demo',
        productionHouseName: 'Demo Production House',
        description: 'A small demo shoot in Mumbai over 3 shoot days.',
        startDate: p1Start,
        endDate: p1End,
        deliveryDate: dayOffset(35),
        locationCity: 'Mumbai',
        budget: 25_00_000_00,
        status: ProjectStatus.active,
        shootDates: [dayOffset(-2), dayOffset(0), dayOffset(2)],
        shootLocations: ['Film City', 'Madh Island'],
      },
      {
        id: project2Id,
        companyUserId: company1Id,
        title: 'Commercial — Demo Q2',
        productionHouseName: 'Demo Production House',
        description: 'Upcoming TVC for a leading FMCG brand.',
        startDate: p2Start,
        endDate: p2End,
        deliveryDate: dayOffset(65),
        locationCity: 'Bangalore',
        budget: 40_00_000_00,
        status: ProjectStatus.open,
        shootDates: [p2Start, dayOffset(22)],
        shootLocations: ['Indiranagar', 'Cubbon Park'],
      },
      {
        id: project3Id,
        companyUserId: company2Id,
        title: 'Documentary Pitch — Himalayan Trails',
        productionHouseName: 'Sunrise Studios',
        description: 'Pitch-stage 4-part documentary series.',
        startDate: p3Start,
        endDate: p3End,
        locationCity: 'Delhi',
        budget: 80_00_000_00,
        status: ProjectStatus.draft,
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Sub-user project assignments
  // ---------------------------------------------------------------------------
  await prisma.subUserProjectAssignment.create({
    data: {
      accountUserId: company1Id,
      subUserId: subUser1Id,
      projectId: project1Id,
    },
  });

  // ---------------------------------------------------------------------------
  // Project roles
  // ---------------------------------------------------------------------------
  await prisma.projectRole.createMany({
    data: [
      { id: role1Id, projectId: project1Id, roleName: 'DOP', qty: 1, rateMin: 45_000_00, rateMax: 60_000_00 },
      { id: role2Id, projectId: project1Id, roleName: 'Sound Engineer', qty: 1, rateMin: 25_000_00, rateMax: 40_000_00 },
      { id: role3Id, projectId: project1Id, roleName: 'Editor', qty: 1, rateMin: 20_000_00, rateMax: 30_000_00 },
      { id: role4Id, projectId: project2Id, roleName: 'DOP', qty: 1, rateMin: 50_000_00, rateMax: 70_000_00 },
      { id: role5Id, projectId: project2Id, roleName: 'Gaffer', qty: 2, rateMin: 18_000_00, rateMax: 25_000_00 },
      { id: role6Id, projectId: project3Id, roleName: 'DOP', qty: 1, rateMin: 55_000_00, rateMax: 75_000_00 },
    ],
  });

  // ---------------------------------------------------------------------------
  // Booking requests — varied states
  // ---------------------------------------------------------------------------
  const now = new Date();
  const shootDateLocs1 = [
    { date: dayOffset(-2).toISOString().slice(0, 10), location: 'Film City' },
    { date: dayOffset(0).toISOString().slice(0, 10), location: 'Film City' },
    { date: dayOffset(2).toISOString().slice(0, 10), location: 'Madh Island' },
  ];

  await prisma.bookingRequest.createMany({
    data: [
      {
        id: booking1Id,
        projectId: project1Id,
        requesterUserId: company1Id,
        targetUserId: freelancer1Id,
        projectRoleId: role1Id,
        status: BookingStatus.locked,
        rateOffered: 50_000_00,
        message: 'We would love you as DOP on Monsoon Short.',
        respondedAt: new Date(now.getTime() - 86_400_000 * 5),
        lockedAt: new Date(now.getTime() - 86_400_000 * 3),
        shootDates: [dayOffset(-2), dayOffset(0), dayOffset(2)],
        shootLocations: ['Film City', 'Madh Island'],
        shootDateLocations: shootDateLocs1,
      },
      {
        id: booking2Id,
        projectId: project1Id,
        requesterUserId: company1Id,
        targetUserId: freelancer2Id,
        projectRoleId: role2Id,
        status: BookingStatus.accepted,
        rateOffered: 32_000_00,
        message: 'Sound for Monsoon Short — boom + radios required.',
        respondedAt: new Date(now.getTime() - 86_400_000 * 4),
        shootDates: [dayOffset(-2), dayOffset(0), dayOffset(2)],
      },
      {
        id: booking3Id,
        projectId: project1Id,
        requesterUserId: company1Id,
        targetUserId: vendor1Id,
        vendorEquipmentId: equipment1Id,
        status: BookingStatus.accepted,
        rateOffered: 15_000_00,
        message: 'FX6 kit for week one.',
        respondedAt: new Date(now.getTime() - 86_400_000 * 2),
        shootDates: [dayOffset(-2), dayOffset(0), dayOffset(2)],
      },
      {
        id: booking4Id,
        projectId: project2Id,
        requesterUserId: company1Id,
        targetUserId: freelancer3Id,
        projectRoleId: null,
        status: BookingStatus.pending,
        rateOffered: 27_000_00,
        message: 'Editor for Q2 TVC — 5-day turnaround post-shoot.',
        expiresAt: new Date(now.getTime() + 86_400_000 * 2),
        shootDates: [p2Start],
      },
      {
        id: booking5Id,
        projectId: project2Id,
        requesterUserId: company1Id,
        targetUserId: freelancer4Id,
        projectRoleId: role5Id,
        status: BookingStatus.declined,
        rateOffered: 20_000_00,
        message: 'Gaffer for Q2 TVC.',
        respondedAt: new Date(now.getTime() - 86_400_000 * 1),
      },
      {
        id: booking6Id,
        projectId: project1Id,
        requesterUserId: company1Id,
        targetUserId: vendor2Id,
        status: BookingStatus.cancel_requested,
        rateOffered: 40_000_00,
        message: 'Catering for 80 crew, 3 days.',
        respondedAt: new Date(now.getTime() - 86_400_000 * 3),
        cancelRequestReason: 'Reducing crew count — will re-book smaller package.',
        cancelRequestedAt: new Date(now.getTime() - 86_400_000 * 1),
      },
      {
        id: booking7Id,
        projectId: project3Id,
        requesterUserId: company2Id,
        targetUserId: freelancer1Id,
        projectRoleId: role6Id,
        status: BookingStatus.pending,
        rateOffered: 55_000_00,
        message: 'DOP for Himalayan Trails — open to counter.',
        counterRate: 65_000_00,
        counterMessage: 'Happy to come on board at ₹65k/day given remote-shoot logistics.',
        counterAt: new Date(now.getTime() - 86_400_000 * 1),
        expiresAt: new Date(now.getTime() + 86_400_000 * 5),
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Conversations + messages
  // ---------------------------------------------------------------------------
  const [c1A, c1B] = [company1Id, freelancer1Id].sort();
  const [c2A, c2B] = [company1Id, freelancer2Id].sort();

  await prisma.conversation.createMany({
    data: [
      {
        id: conv1Id,
        projectId: project1Id,
        participantA: c1A,
        participantB: c1B,
        lastMessageAt: new Date(now.getTime() - 86_400_000),
      },
      {
        id: conv2Id,
        projectId: project1Id,
        participantA: c2A,
        participantB: c2B,
        lastMessageAt: new Date(now.getTime() - 86_400_000 * 2),
      },
    ],
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conv1Id,
        senderId: company1Id,
        type: MessageType.text,
        content: 'Hi Riya — confirming call time 7 AM Monday.',
        isRead: true,
        isPinned: true,
        readAt: new Date(now.getTime() - 86_400_000 * 2 + 1_800_000),
        createdAt: new Date(now.getTime() - 86_400_000 * 2),
      },
      {
        conversationId: conv1Id,
        senderId: freelancer1Id,
        type: MessageType.text,
        content: 'Sounds good. I will bring the full camera package.',
        isRead: true,
        readAt: new Date(now.getTime() - 86_400_000 * 2 + 3_800_000),
        createdAt: new Date(now.getTime() - 86_400_000 * 2 + 3_600_000),
      },
      {
        conversationId: conv1Id,
        senderId: company1Id,
        type: MessageType.text,
        content: 'Perfect, see you on set.',
        isRead: false,
        createdAt: new Date(now.getTime() - 86_400_000),
      },
      {
        conversationId: conv2Id,
        senderId: company1Id,
        type: MessageType.text,
        content: 'Arjun, can you confirm the radio mic count for Monsoon?',
        isRead: true,
        readAt: new Date(now.getTime() - 86_400_000 * 2 + 1_200_000),
        createdAt: new Date(now.getTime() - 86_400_000 * 2 - 3_600_000),
      },
      {
        conversationId: conv2Id,
        senderId: freelancer2Id,
        type: MessageType.text,
        content: '4 x DPA radios + 2 booms. All good.',
        isRead: true,
        readAt: new Date(now.getTime() - 86_400_000 * 2),
        createdAt: new Date(now.getTime() - 86_400_000 * 2 - 1_800_000),
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Invoices — draft / sent / paid
  // ---------------------------------------------------------------------------
  const inv1Amount = 150_000_00;
  const inv1Gst = Math.round(inv1Amount * 0.18);
  const inv2Amount = 45_000_00;
  const inv2Gst = Math.round(inv2Amount * 0.18);
  const inv3Amount = 96_000_00;
  const inv3Gst = Math.round(inv3Amount * 0.18);

  await prisma.invoice.create({
    data: {
      id: invoice1Id,
      projectId: project1Id,
      issuerUserId: freelancer1Id,
      recipientUserId: company1Id,
      invoiceNumber: 'INV-DEMO-000001',
      amount: inv1Amount,
      gstAmount: inv1Gst,
      totalAmount: inv1Amount + inv1Gst,
      status: InvoiceStatus.sent,
      dueDate: dayOffset(14),
      lineItems: {
        create: [
          {
            description: 'Monsoon Short — DOP fees (3 shoot days @ ₹50,000)',
            quantity: new Prisma.Decimal(3),
            unitPrice: 50_000_00,
            amount: inv1Amount,
          },
        ],
      },
      attachments: {
        create: [
          {
            fileKey: 'demo/invoices/INV-DEMO-000001.pdf',
            fileName: 'INV-DEMO-000001.pdf',
            mimeType: 'application/pdf',
            size: 24_576,
          },
        ],
      },
    },
  });

  await prisma.invoice.create({
    data: {
      id: invoice2Id,
      projectId: project1Id,
      issuerUserId: vendor1Id,
      recipientUserId: company1Id,
      invoiceNumber: 'INV-DEMO-000002',
      amount: inv2Amount,
      gstAmount: inv2Gst,
      totalAmount: inv2Amount + inv2Gst,
      status: InvoiceStatus.paid,
      dueDate: dayOffset(-3),
      paidAt: new Date(now.getTime() - 86_400_000 * 1),
      lineItems: {
        create: [
          {
            description: 'Sony FX6 Kit — 3 days',
            quantity: new Prisma.Decimal(3),
            unitPrice: 15_000_00,
            amount: inv2Amount,
          },
        ],
      },
    },
  });

  await prisma.invoice.create({
    data: {
      id: invoice3Id,
      projectId: project1Id,
      issuerUserId: freelancer2Id,
      recipientUserId: company1Id,
      invoiceNumber: 'INV-DEMO-000003',
      amount: inv3Amount,
      gstAmount: inv3Gst,
      totalAmount: inv3Amount + inv3Gst,
      status: InvoiceStatus.draft,
      dueDate: dayOffset(21),
      lineItems: {
        create: [
          {
            description: 'Sound Engineer — 3 days @ ₹32,000',
            quantity: new Prisma.Decimal(3),
            unitPrice: 32_000_00,
            amount: inv3Amount,
          },
        ],
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Contracts
  // ---------------------------------------------------------------------------
  await prisma.contract.create({
    data: {
      id: contract1Id,
      bookingId: booking1Id,
      fileKey: 'demo/contracts/monsoon-dop.pdf',
      fileName: 'monsoon-dop.pdf',
      signedByA: true,
      signedByB: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Reviews
  // ---------------------------------------------------------------------------
  await prisma.review.createMany({
    data: [
      {
        bookingId: booking1Id,
        reviewerUserId: company1Id,
        revieweeUserId: freelancer1Id,
        rating: 5,
        text: 'Excellent collaborator — punctual and creative.',
      },
      {
        bookingId: booking2Id,
        reviewerUserId: company1Id,
        revieweeUserId: freelancer2Id,
        rating: 4,
        text: 'Clean sound, great attitude on set.',
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      {
        userId: freelancer1Id,
        type: 'booking_locked',
        title: 'Booking confirmed',
        body: 'Your booking for Monsoon Short is locked.',
        data: { bookingId: booking1Id, projectId: project1Id },
      },
      {
        userId: freelancer1Id,
        type: 'booking_countered',
        title: 'Counter offer received',
        body: 'Sunrise Studios countered your rate on Himalayan Trails.',
        data: { bookingId: booking7Id, projectId: project3Id },
      },
      {
        userId: company1Id,
        type: 'invoice_sent',
        title: 'Invoice received',
        body: 'You have a new invoice from Riya Sharma.',
        data: { invoiceId: invoice1Id, projectId: project1Id },
      },
      {
        userId: company1Id,
        type: 'booking_cancel_requested',
        title: 'Cancellation requested',
        body: 'Reel Catering Co has requested cancellation.',
        data: { bookingId: booking6Id, projectId: project1Id },
        readAt: new Date(now.getTime() - 3_600_000),
      },
      {
        userId: freelancer3Id,
        type: 'booking_request',
        title: 'New booking request',
        body: 'Demo Production House wants you as Editor on Commercial — Demo Q2.',
        data: { bookingId: booking4Id, projectId: project2Id },
      },
    ],
  });

  console.log(`\nLight seed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\nAll accounts use password: ' + DEFAULT_PASSWORD);
  console.log('  admin@claapo.test');
  console.log('  company1@claapo.test   (Demo Production House)');
  console.log('  company2@claapo.test   (Sunrise Studios)');
  console.log('  subuser1@claapo.test   (sub-user of company1)');
  console.log('  freelancer1@claapo.test (Riya Sharma — DOP)');
  console.log('  freelancer2@claapo.test (Arjun Verma — Sound)');
  console.log('  freelancer3@claapo.test (Priya Patel — Editor)');
  console.log('  freelancer4@claapo.test (Karan Mehta — Gaffer)');
  console.log('  vendor1@claapo.test    (Demo Cine Rentals)');
  console.log('  vendor2@claapo.test    (Reel Catering Co)');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
