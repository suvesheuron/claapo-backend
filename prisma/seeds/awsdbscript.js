/**
 * awsdbscript.js — Create 10 users + matching profiles for each role.
 *
 * Why profiles matter:
 *   Search service (`SearchService.searchCrew` etc.) queries the profile tables
 *   (IndividualProfile, VendorProfile, CompanyProfile, CastProfile) — NOT the
 *   User table directly. A user without a profile can log in but cannot be found.
 *
 * Categories seeded (10 each, 50 total):
 *   - admin         → no profile (admins don't appear in search)
 *   - individual    → IndividualProfile (skill: DOP / Sound / Editor / Gaffer rotation)
 *   - company       → CompanyProfile
 *   - vendor        → VendorProfile (vendorType rotates: equipment, lighting, transport, catering)
 *   - cast          → CastProfile (actor / model alternating)
 *
 * Default credentials:
 *   email:    <role><N>@claapo.test   (e.g. individual5@claapo.test)
 *   phone:    role-prefixed 10 digits (e.g. 9300000005)
 *   password: Test@1234
 *   isVerified: true (immediate login)
 *
 * Idempotent — uses `upsert` keyed on email / userId.
 *
 * To purge existing seed users before re-running, set WIPE_FIRST=true env var.
 * It only deletes users with @claapo.test email — leaves real users alone.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const PASSWORD = 'Test@1234';
const PER_ROLE = 10;
const WIPE_FIRST = process.env.WIPE_FIRST === 'true';

// Rotating attribute pools so seeded users have variety.
const CITIES = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Goa'];
const STATES = ['Maharashtra', 'Delhi', 'Karnataka', 'Telangana', 'Tamil Nadu', 'Maharashtra', 'West Bengal', 'Gujarat', 'Rajasthan', 'Goa'];
const SKILLS_POOL = ['DOP', 'Sound Engineer', 'Editor', 'Gaffer'];
const GENRES_POOL = ['Feature Film', 'Documentary', 'Commercial', 'Music Video', 'Short Film', 'Web Series'];
const VENDOR_TYPES = ['equipment', 'lighting', 'transport', 'catering'];
const COMPANY_TYPES = ['Production House', 'Post Production', 'Studio'];
const CAST_ROLE_TYPES = ['actor', 'model'];
const CAST_GENDERS = ['male', 'female'];

const PHONE_PREFIX = {
  admin: '9100',
  individual: '9300',
  company: '9200',
  vendor: '9400',
  cast: '9500',
};

function phoneFor(role, i) {
  return `${PHONE_PREFIX[role]}${String(i).padStart(6, '0')}`;
}

async function wipeSeedUsers() {
  console.log('==> WIPE_FIRST=true — deleting existing @claapo.test users + their profiles');
  // Profiles are deleted via cascade if the schema has onDelete: Cascade,
  // but be safe and delete them explicitly first.
  const where = { email: { endsWith: '@claapo.test' } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log('    no existing seed users found');
    return;
  }
  console.log(`    found ${ids.length} seed users — wiping`);
  // Best-effort cleanup of dependent tables
  await prisma.individualProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.companyProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.vendorProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.castProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.otpSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log('    wipe done');
  console.log('');
}

async function upsertUser(role, i, passwordHash) {
  const email = `${role}${i}@claapo.test`;
  const phone = phoneFor(role, i);
  return prisma.user.upsert({
    where: { email },
    update: {
      phone,
      displayName: `${role.charAt(0).toUpperCase()}${role.slice(1)} ${i}`,
      passwordHash,
      role,
      isVerified: true,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email,
      phone,
      displayName: `${role.charAt(0).toUpperCase()}${role.slice(1)} ${i}`,
      passwordHash,
      role,
      isVerified: true,
      isActive: true,
    },
  });
}

async function seedAdmins(passwordHash) {
  console.log(`==> Seeding ${PER_ROLE} admins (no profile — admins don't appear in search)`);
  for (let i = 1; i <= PER_ROLE; i++) {
    const user = await upsertUser('admin', i, passwordHash);
    console.log(`    admin       admin${i}@claapo.test`.padEnd(50) + ` id=${user.id.slice(0, 8)}...`);
  }
  console.log('');
}

async function seedIndividuals(passwordHash) {
  console.log(`==> Seeding ${PER_ROLE} individuals + IndividualProfile`);
  for (let i = 1; i <= PER_ROLE; i++) {
    const user = await upsertUser('individual', i, passwordHash);
    const skill = SKILLS_POOL[(i - 1) % SKILLS_POOL.length];
    const city = CITIES[(i - 1) % CITIES.length];
    const state = STATES[(i - 1) % STATES.length];

    await prisma.individualProfile.upsert({
      where: { userId: user.id },
      update: {
        displayName: `${skill} ${i}`,
        bio: `Experienced ${skill.toLowerCase()} with ${5 + i} years in the Indian film industry.`,
        skills: [skill],
        genres: [GENRES_POOL[(i - 1) % GENRES_POOL.length], GENRES_POOL[i % GENRES_POOL.length]],
        locationCity: city,
        locationState: state,
        dailyBudget: 10000 + i * 2000,
        isAvailable: true,
      },
      create: {
        userId: user.id,
        displayName: `${skill} ${i}`,
        bio: `Experienced ${skill.toLowerCase()} with ${5 + i} years in the Indian film industry.`,
        skills: [skill],
        genres: [GENRES_POOL[(i - 1) % GENRES_POOL.length], GENRES_POOL[i % GENRES_POOL.length]],
        locationCity: city,
        locationState: state,
        dailyBudget: 10000 + i * 2000,
        isAvailable: true,
      },
    });
    console.log(`    individual  individual${i}@claapo.test ${skill.padEnd(15)} ${city.padEnd(12)} ₹${10000 + i * 2000}/day`);
  }
  console.log('');
}

async function seedCompanies(passwordHash) {
  console.log(`==> Seeding ${PER_ROLE} companies + CompanyProfile`);
  for (let i = 1; i <= PER_ROLE; i++) {
    const user = await upsertUser('company', i, passwordHash);
    const city = CITIES[(i - 1) % CITIES.length];
    const state = STATES[(i - 1) % STATES.length];
    const companyType = COMPANY_TYPES[(i - 1) % COMPANY_TYPES.length];

    await prisma.companyProfile.upsert({
      where: { userId: user.id },
      update: {
        companyName: `${companyType} ${i}`,
        companyType,
        skills: ['Production', 'Post-Production'],
        locationCity: city,
        locationState: state,
        address: `${i}00 Studio Lane, ${city}`,
      },
      create: {
        userId: user.id,
        companyName: `${companyType} ${i}`,
        companyType,
        skills: ['Production', 'Post-Production'],
        locationCity: city,
        locationState: state,
        address: `${i}00 Studio Lane, ${city}`,
      },
    });
    console.log(`    company     company${i}@claapo.test ${companyType.padEnd(18)} ${city}`);
  }
  console.log('');
}

async function seedVendors(passwordHash) {
  console.log(`==> Seeding ${PER_ROLE} vendors + VendorProfile`);
  for (let i = 1; i <= PER_ROLE; i++) {
    const user = await upsertUser('vendor', i, passwordHash);
    const city = CITIES[(i - 1) % CITIES.length];
    const state = STATES[(i - 1) % STATES.length];
    const vendorType = VENDOR_TYPES[(i - 1) % VENDOR_TYPES.length];

    await prisma.vendorProfile.upsert({
      where: { userId: user.id },
      update: {
        companyName: `${vendorType.charAt(0).toUpperCase()}${vendorType.slice(1)} Vendor ${i}`,
        vendorType,
        locationCity: city,
        locationState: state,
        address: `${i}00 Industrial Area, ${city}`,
      },
      create: {
        userId: user.id,
        companyName: `${vendorType.charAt(0).toUpperCase()}${vendorType.slice(1)} Vendor ${i}`,
        vendorType,
        locationCity: city,
        locationState: state,
        address: `${i}00 Industrial Area, ${city}`,
      },
    });
    console.log(`    vendor      vendor${i}@claapo.test  ${vendorType.padEnd(12)} ${city}`);
  }
  console.log('');
}

async function seedCast(passwordHash) {
  console.log(`==> Seeding ${PER_ROLE} cast + CastProfile`);
  for (let i = 1; i <= PER_ROLE; i++) {
    const user = await upsertUser('cast', i, passwordHash);
    const city = CITIES[(i - 1) % CITIES.length];
    const state = STATES[(i - 1) % STATES.length];
    const roleType = CAST_ROLE_TYPES[(i - 1) % CAST_ROLE_TYPES.length];
    const gender = CAST_GENDERS[(i - 1) % CAST_GENDERS.length];

    await prisma.castProfile.upsert({
      where: { userId: user.id },
      update: {
        displayName: `Cast ${i}`,
        roleType,
        gender,
        age: 22 + i,
        heightCm: 165 + i,
        bio: `${roleType === 'actor' ? 'Actor' : 'Model'} based in ${city}.`,
        languages: ['Hindi', 'English'],
      },
      create: {
        userId: user.id,
        displayName: `Cast ${i}`,
        roleType,
        gender,
        age: 22 + i,
        heightCm: 165 + i,
        bio: `${roleType === 'actor' ? 'Actor' : 'Model'} based in ${city}.`,
        languages: ['Hindi', 'English'],
      },
    });
    console.log(`    cast        cast${i}@claapo.test    ${roleType.padEnd(8)} ${gender.padEnd(7)} ${city}`);
  }
  console.log('');
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  console.log(`Default password for every account: ${PASSWORD}`);
  console.log('');

  if (WIPE_FIRST) {
    await wipeSeedUsers();
  }

  await seedAdmins(passwordHash);
  await seedIndividuals(passwordHash);
  await seedCompanies(passwordHash);
  await seedVendors(passwordHash);
  await seedCast(passwordHash);

  console.log('==============================================');
  console.log('Done. 50 users + profiles created/updated.');
  console.log(`Password for all accounts: ${PASSWORD}`);
  console.log('Crew search will return 10 individuals.');
  console.log('Vendor search will return 10 vendors.');
  console.log('Company search will return 10 companies.');
  console.log('==============================================');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
