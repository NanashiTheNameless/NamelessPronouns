import db from './db/index.js';
import { compileRule } from './content-rules.js';
import { newId } from './util/ids.js';
export function seedInsertStatements(rule, { now = Date.now(), versionId = newId() } = {}) {
  return [
    {
      sql: `INSERT INTO content_rules (id, current_version_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)`,
      params: [rule.id, versionId, now, now],
    },
    {
      sql: `INSERT INTO content_rule_versions
              (id, rule_id, version, rule_type, match_value, category, severity,
               mode, explanation, created_at)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        versionId,
        rule.id,
        rule.type,
        rule.matchValue,
        rule.category,
        rule.severity,
        rule.mode,
        rule.explanation || null,
        now,
      ],
    },
  ];
}
export async function importMissingSeedRules(rules, { database = db, log = () => {} } = {}) {
  const imported = [];
  const skipped = [];
  for (const rule of rules) {
    const { rows } = await database.query('SELECT id FROM content_rules WHERE id = ?', [rule.id]);
    if (rows.length > 0) {
      skipped.push(rule.id);
      log(`Skipped existing content rule ${rule.id}`);
      continue;
    }
    try {
      await database.batch(seedInsertStatements(rule));
      imported.push(rule.id);
      log(`Imported content rule ${rule.id}`);
    } catch (error) {
      const check = await database.query('SELECT id FROM content_rules WHERE id = ?', [rule.id]);
      if (check.rows.length === 0) throw error;
      skipped.push(rule.id);
      log(`Skipped concurrently imported content rule ${rule.id}`);
    }
  }
  return { imported, skipped };
}
export async function loadCurrentRules({ database = db } = {}) {
  const { rows } = await database.query(
    `SELECT v.rule_id AS id, v.id AS version_id, v.rule_type AS type, v.match_value AS match,
            v.category, v.severity,
            CASE WHEN v.mode = 'shadow' AND v.enforce_at IS NOT NULL AND v.enforce_at <= ?
                 THEN 'enforcing' ELSE v.mode END AS mode,
            v.explanation
       FROM content_rules r
       JOIN content_rule_versions v ON v.id = r.current_version_id
      ORDER BY v.rule_id`,
    [Date.now()],
  );
  return rows.map((row) => compileRule({ ...row, versionId: row.version_id }));
}
