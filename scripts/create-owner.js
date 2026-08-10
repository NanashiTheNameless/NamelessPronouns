#!/usr/bin/env node
import readline from 'node:readline';
import { Writable } from 'node:stream';
import db from '../src/db/index.js';
import logger from '../src/logger.js';
import { newId } from '../src/util/ids.js';
import { hashPassword } from '../src/auth/password.js';
import * as V from '../src/validation.js';
import { personalProfileStatements } from '../src/profiles.js';
function usage() {
  process.stderr.write('Usage: create-owner <email> [initial-profile-username]\n');
  process.exit(2);
}
const [, , rawEmail, rawUsername] = process.argv;
if (!rawEmail) usage();
let email;
let username = null;
try {
  email = V.email(rawEmail);
  username = rawUsername ? V.username(rawUsername) : null;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
function promptHidden(question) {
  if (process.stdin.isTTY) {
    return new Promise((resolve) => {
      let muted = false;
      const mutableOut = new Writable({
        write(chunk, enc, cb) {
          if (!muted) process.stdout.write(chunk, enc);
          cb();
        },
      });
      const rl = readline.createInterface({ input: process.stdin, output: mutableOut, terminal: true });
      rl.question(question, (answer) => {
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
      muted = true;
    });
  }
  process.stdout.write(question);
  return Promise.resolve(nextPipedLine());
}
let pipedLines = null;
function loadPipedLines() {
  return new Promise((resolve) => {
    const lines = [];
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => lines.push(l));
    rl.on('close', () => resolve(lines));
  });
}
function nextPipedLine() {
  return pipedLines.length ? pipedLines.shift() : '';
}
async function main() {
  if (!process.stdin.isTTY) pipedLines = await loadPipedLines();
  const password = await promptHidden('Owner password: ');
  const confirm = await promptHidden('Confirm password: ');
  if (password !== confirm) {
    process.stderr.write('Passwords do not match.\n');
    process.exit(1);
  }
  const { hash, version } = await hashPassword(password);
  const now = Date.now();
  const userId = newId();
  const statements = [
    {
      sql: `INSERT INTO users
              (id, email, password_hash, password_hash_version, email_verified_at,
               signup_status, requested_profile_username, staff_role, twofa_method,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'approved', ?, 'owner', 'email', ?, ?)`,
      params: [userId, email, hash, version, now, username, now, now],
    },
  ];
  if (username) {
    statements.push(
      {
        sql: `INSERT INTO public_username_claims
                (username, state, pending_user_id, requested_display_name, created_at)
              VALUES (?, 'pending', ?, ?, ?)`,
        params: [username, userId, username, now],
      },
      ...personalProfileStatements({ userId, username, displayName: username, now }).statements,
    );
  }
  statements.push({
    sql: `INSERT INTO audit_events (id, event_type, actor_user_id, subject_user_id, created_at)
          VALUES (?, 'owner.bootstrap_created', ?, ?, ?)`,
    params: [newId(), userId, userId, now],
  });
  await db.batch(statements);
  logger.info('owner created', { userId, username });
}
try {
  await main();
  await db.close();
  process.exit(0);
} catch (err) {
  logger.error('create-owner failed', { error: err.message });
  await db.close().catch(() => {});
  process.exit(1);
}
