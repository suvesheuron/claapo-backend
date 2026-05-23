/**
 * awsdbscript.js — Bulk-create 10 demo users per role for the AWS production DB.
 *
 * Plain JS (no ts-node, no TypeScript compile step). The runtime Docker image
 * already has @prisma/client and bcrypt installed as production deps, so this
 * runs with just `node`.
 *
 * Run via the claapo-api-seed ECS task definition, or locally:
 *   DATABASE_URL=... DIRECT_URL=... node prisma/seeds/awsdbscript.js
 *
 * Idempotent — uses `upsert` keyed on email.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const PASSWORD = 'Test@1234';
const PER_ROLE = 10;

const PHONE_PREFIX = {
  admin: '9100',
  company: '9200',
  individual: '9300',
  vendor: '9400',
};

const DISPLAY_LABEL = {
  admin: 'Admin',
  company: 'Production House',
  individual: 'Freelancer',
  vendor: 'Vendor',
};

const ROLES_TO_SEED = ['admin', 'company', 'individual', 'vendor'];

function phoneFor(role, i) {
  return `${PHONE_PREFIX[role]}${String(i).padStart(6, '0')}`;
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
      const displayName = `${DISPLAY_LABEL[role]} ${i}`;

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
