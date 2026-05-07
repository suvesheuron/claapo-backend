/**
 * Terminate any backend that is holding Prisma's migration advisory lock
 * (objid 72707369) on the Neon DB. Run via DIRECT_URL.
 *
 *   npx ts-node scripts/kill-neon-lock.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

(async () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL! } },
  });
  await prisma.$connect();

  const holders: any[] = await prisma.$queryRawUnsafe(`
    SELECT pid, mode, granted FROM pg_locks
    WHERE locktype = 'advisory' AND objid = 72707369;
  `);
  console.log('Lock holders before:', holders);

  for (const h of holders) {
    const r: any[] = await prisma.$queryRawUnsafe(
      `SELECT pg_terminate_backend(${h.pid}) AS killed;`,
    );
    console.log(`pg_terminate_backend(${h.pid}) →`, r[0]);
  }

  const after: any[] = await prisma.$queryRawUnsafe(`
    SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = 72707369;
  `);
  console.log('Lock holders after:', after);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
