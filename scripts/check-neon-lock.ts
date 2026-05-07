/**
 * Diagnose Neon advisory-lock contention.
 * Run: npx ts-node scripts/check-neon-lock.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

(async () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL! } },
  });
  await prisma.$connect();
  console.log('→ Connected via DIRECT_URL\n');

  const locks: any[] = await prisma.$queryRawUnsafe(`
    SELECT pid, locktype, classid::text, objid::text, granted, mode,
           (SELECT application_name FROM pg_stat_activity WHERE pid = pg_locks.pid) AS app,
           (SELECT state FROM pg_stat_activity WHERE pid = pg_locks.pid) AS state,
           (SELECT client_addr::text FROM pg_stat_activity WHERE pid = pg_locks.pid) AS client_addr,
           (SELECT left(query,160) FROM pg_stat_activity WHERE pid = pg_locks.pid) AS query
    FROM pg_locks WHERE locktype = 'advisory';
  `);
  console.log('Advisory locks held:');
  console.dir(locks, { depth: null });

  const all: any[] = await prisma.$queryRawUnsafe(`
    SELECT pid, application_name AS app, state, client_addr::text AS client_addr,
           state_change::text, left(query, 140) AS query
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
    ORDER BY state_change DESC NULLS LAST
    LIMIT 30;
  `);
  console.log('\nOther active connections (top 30):');
  console.dir(all, { depth: null });

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
