#!/usr/bin/env node
import config from '../src/config.js';
import db from '../src/db/index.js';
import logger from '../src/logger.js';
import { loadSeed } from '../src/content-rules.js';
import { importMissingSeedRules } from '../src/content-rule-store.js';
try {
  const rules = await loadSeed(config.CONTENT_RULES_SEED_PATH);
  const result = await importMissingSeedRules(rules, {
    log: (message) => logger.info(message),
  });
  logger.info('content-rule import finished', {
    imported: result.imported.length,
    skipped: result.skipped.length,
  });
  await db.close();
  process.exit(0);
} catch (error) {
  logger.error('content-rule import failed', { error: error.message });
  await db.close().catch(() => {});
  process.exit(1);
}
