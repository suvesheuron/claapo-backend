/**
 * awsdbscript.ts — Bulk-create 10 demo users per role for the AWS production DB.
 *
 * Usage (locally):
 *   cd crewcall-backend
 *   DATABASE_URL=... DIRECT_URL=... npx ts-node prisma/seeds/awsdbscript.ts
 *
 * Usage (production via one-off ECS task — see migrate.sh pattern):
 *   See the matching awsdbscript.sh runner.
 *
 * What it creates:
 *   - 10 admins      (admin1@claapo.test ... admin10@claapo.test)
 *   - 10 companies   (company1@claapo.test ...)
 *   - 10 individuals (individual1@claapo.test ...)
 *   - 10 vendors     (vendor1@claapo.test ...)
 *
 * Each user has:
 *   - email:    <role><N>@claapo.test
 *   - phone:    a unique 10-digit phone (role-prefixed)
 *   - password: Test@1234 (bcrypt-hashed)
 *   - isVerified: true (so they can log in immediately)
 *
 * Safe to re-run — uses `upsert` keyed on email, so existing users are updated
 * in-place rather than duplicated.
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Test@1234';
const PER_ROLE = 10;

// Phone-prefix per role so phones never collide across roles.
// 9100xxxxxx = admins, 9200xxxxxx = companies, 9300xxxxxx = individuals, 9400xxxxxx = vendors.
const PHONE_PREFIX: Record<UserRole, string> = {
  admin: '9100',
  company: '9200',
  individual: '9300',
  vendor: '9400',
  cast: '9500', // not seeded here, included for type completeness
  location: '9600', // not seeded here, included for type completeness
};

const ROLES_TO_SEED: UserRole[] = [
  UserRole.admin,
  UserRole.company,
  UserRole.individual,
  UserRole.vendor,
];

function phoneFor(role: UserRole, i: number): string {
  // Produce e.g. "9100000001" — 10 digits, role-prefixed, padded.
  const suffix = String(i).padStart(6, '0');
  return `${PHONE_PREFIX[role]}${suffix}`;
}

function displayNameFor(role: UserRole, i: number): string {
  const labels: Record<UserRole, string> = {
    admin: 'Admin',
    company: 'Production House',
    individual: 'Freelancer',
    vendor: 'Vendor',
    cast: 'Cast',
    location: 'Location',
  };
  return `${labels[role]} ${i}`;
}

async function main() {
  console.log(`Seeding ${PER_ROLE} users per role (${ROLES_TO_SEED.length} roles)`);
  console.log(`Default password for every account: ${PASSWORD}`);
  console.log('');

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  let total = 0;

  for (const role of ROLES_TO_SEED) {
    console.log(`==> Seeding ${PER_ROLE} ${role}s`);
    for (let i = 1; i <= PER_ROLE; i++) {
      const email = `${role}${i}@claapo.test`;
      const phone = phoneFor(role, i);
      const displayName = displayNameFor(role, i);

      const user = await prisma.user.upsert({
        where: { email },
        update: {
          phone,
          displayName,
          passwordHash,
          role,
          isVerified: true,
          isActive: true,
          deletedAt: null,
        },
        create: {
          email,
          phone,
          displayName,
          passwordHash,
          role,
          isVerified: true,
          isActive: true,
        },
      });

      console.log(`    ${role.padEnd(10)}  ${email.padEnd(32)}  ${phone}  id=${user.id.slice(0, 8)}...`);
      total++;
    }
    console.log('');
  }

  console.log('==============================================');
  console.log(`Done. ${total} users created/updated.`);
  console.log(`Password for all accounts: ${PASSWORD}`);
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
