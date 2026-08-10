#!/usr/bin/env node
import { migrate } from '../src/db/migrate.js';
import db from '../src/db/index.js';
import logger from '../src/logger.js';
try {
  const applied = await migrate({ log: (m) => logger.info(m) });
  logger.info('migrate finished', { count: applied.length });
  await db.close();
  process.exit(0);
} catch (err) {
  logger.error('migrate failed', { error: err.message });
  await db.close().catch(() => {});
  process.exit(1);
}
