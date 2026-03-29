/**
 * Wipe all rows from the database (keeps schema).
 *
 *   npx ts-node prisma/seeds/wipe-database.ts
 *   npm run prisma:wipe
 */
import { PrismaClient } from '@prisma/client';
import { wipeDatabase } from './lib/wipe-database';

const prisma = new PrismaClient();

async function main() {
  console.log('Wiping all application data...');
  await wipeDatabase(prisma);
  console.log('Done. Database is empty (schema unchanged).');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
