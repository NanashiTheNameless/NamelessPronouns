import express from 'express';
import ejs from 'ejs';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import config from './config.js';
import db from './db/index.js';
import logger from './logger.js';
import { securityHeaders } from './middleware/security-headers.js';
import { sessionMiddleware, requireAuth, requireApproved } from './middleware/session.js';
import { policyGate } from './middleware/policy-gate.js';
import { csrfProtection } from './middleware/csrf.js';
import { restrictedSessionGate } from './middleware/restricted-session.js';
import { deletionSessionGate } from './middleware/deletion-session.js';
import { scheduleMaintenance } from './maintenance.js';
import { scheduleCommunityRefresh } from './email-domains.js';
import { scheduleMailDrain } from './mail.js';
import { pendingMigrations } from './db/migrate.js';
import consentRoutes from './routes/consent.js';
import legalRoutes from './routes/legal.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import accountRoutes from './routes/account.js';
import publicProfileRoutes from './routes/public-profile.js';
import profileEditorRoutes from './routes/profile-editor.js';
import moderationRoutes from './routes/moderation.js';
import contentRuleAdminRoutes from './routes/content-rule-admin.js';
import recoveryRoutes from './routes/recovery.js';
import adminManagementRoutes from './routes/admin-management.js';
import { obfuscateEmail, obfuscateEmails } from './email-obfuscation.js';
import { contentFieldLabel } from './content-fields.js';
const root = fileURLToPath(new URL('..', import.meta.url));
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.engine('ejs', (file, data, callback) => {
    ejs.renderFile(file, data, { async: true }).then((html) => callback(null, html), callback);
  });
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use((req, res, next) => {
    res.append('Link', '</humans.txt>; rel="author"');
    res.setHeader('X-Nanashi', 'was-here');
    next();
  });
  app.head('/teapot', (req, res) => {
    res.setHeader('X-Tea', 'omitted');
    res.setHeader('X-Tea-Made-By', 'NamelessNanashi');
    res.status(418).end();
  });
  app.get('/teapot', (req, res) => {
    res.setHeader('X-Tea-Made-By', 'NamelessNanashi');
    res.type('text/plain').status(418).send("I'm a teapot. It/its, thanks.\n");
  });
  app.get('/humans.txt', (req, res) => {
    res.type('text/plain').send('/* HUMANS */\nHuman: NamelessNanashi\nSite: NamelessPronouns\n\nThanks for remembering the humans behind NamelessPronouns.\n');
  });
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('# Crawl if you like. You may not remember this place.\n# Nanashi was here. The crawler saw nothing.\nUser-agent: *\nAllow: /\n');
  });
  app.get('/.well-known/nameless', (req, res) => {
    res.json({ name: null, pronouns: 'any/all', owner: 'NamelessNanashi' });
  });
  app.get('/nothing', (req, res) => {
    res.setHeader('X-Nothing', 'successfully-returned');
    res.setHeader('X-Nothing-By', 'NamelessNanashi');
    res.status(204).end();
  });
  app.get('/404', (req, res) => {
    const ownerMessage = Object.hasOwn(req.query, 'owner') ? ' If found, return this page to NamelessNanashi.' : '';
    res.status(404).render('error', { title: 'Found it', status: 404, message: `Congratulations. You found it.${ownerMessage}` });
  });
  app.get('/healthz', async (req, res) => {
    try {
      await db.ping();
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error('healthz db ping failed', { error: err.message });
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get('/readyz', async (req, res) => {
    try {
      await db.ping();
      const pending = await pendingMigrations();
      if (pending.length > 0) return res.status(503).json({ status: 'migrations-pending', pending });
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use('/static', express.static(path.join(root, 'public'), {
    immutable: true,
    maxAge: '1y',
    setHeaders(res, filePath) {
      if (
        filePath.includes(`${path.sep}css${path.sep}`)
        || filePath.includes(`${path.sep}js${path.sep}`)
        || filePath.includes(`${path.sep}password-wordlists${path.sep}`)
      ) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }));
  app.get('/static/vendor/altcha/obfuscation.js', (req, res) => res.sendFile(path.join(root, 'node_modules/altcha/dist/plugins/obfuscation.plugin.min.js')));
  app.get('/static/vendor/altcha/widget.js', (req, res) => res.sendFile(path.join(root, 'node_modules/altcha/dist/main/altcha.min.js')));
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false, limit: '96kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.locals.obfuscateEmail = obfuscateEmail;
    res.locals.obfuscateEmails = obfuscateEmails;
    res.locals.contentFieldLabel = contentFieldLabel;
    next();
  });
  app.use(sessionMiddleware());
  app.use(policyGate());
  app.use(restrictedSessionGate());
  app.use(deletionSessionGate());
  app.use(csrfProtection());
  app.use(consentRoutes);
  app.use(legalRoutes);
  app.use(authRoutes);
  app.use(adminRoutes);
  app.use(adminManagementRoutes);
  app.use(contentRuleAdminRoutes);
  app.use(recoveryRoutes);
  app.use(accountRoutes);
  app.use(moderationRoutes);
  app.use(profileEditorRoutes);
  app.use(publicProfileRoutes);
  app.get('/', (req, res) => res.render('home', { title: 'NamelessPronouns' }));
  app.get('/dashboard', requireApproved, async (req, res) => {
    const { rows } = await db.query(
      `SELECT p.id, p.username_display AS username, p.display_name, p.published, wm.role
         FROM profiles p
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
        WHERE wm.user_id = ?
        ORDER BY p.username`,
      [req.user.id],
    );
    res.render('dashboard', { title: 'Dashboard', profiles: rows });
  });
  app.get('/account/suspended', requireAuth, (req, res) => res.render('account/suspended', { title: 'Account restricted' }));
  app.use((req, res) => res.status(404).render('error', { title: 'Not found', status: 404, message: 'Page not found.' }));
  app.use((err, req, res, next) => {
    logger.error('unhandled error', { error: err.message });
    res.status(500).render('error', { title: 'Error', status: 500, message: 'Something went wrong.' });
  });
  return app;
}
export async function start() {
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info('server listening', { port: config.PORT, backend: db.backend, env: config.NODE_ENV });
  });
  const maintenance = scheduleMaintenance();
  const communityRefresh = scheduleCommunityRefresh();
  const mailDrain = scheduleMailDrain();
  async function shutdown(signal) {
    logger.info('shutting down', { signal });
    clearInterval(maintenance);
    if (communityRefresh) clearInterval(communityRefresh);
    clearInterval(mailDrain);
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    logger.error('failed to start', { error: err.message });
    process.exit(1);
  });
}
