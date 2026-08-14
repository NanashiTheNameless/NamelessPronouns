import express from 'express';
import { publicPageHeaders } from '../middleware/security-headers.js';
import { loadLegalDocument } from '../legal-documents.js';
import { listSupporters, listSupportLinks } from '../supporters.js';
const router = express.Router();
router.use(publicPageHeaders);
router.get('/terms', async (req, res) => {
  res.render('legal/document', { document: await loadLegalDocument('terms') });
});
router.get('/privacy', async (req, res) => {
  res.render('legal/document', { document: await loadLegalDocument('privacy') });
});
router.get('/contact', (req, res) => res.render('legal/contact', { title: 'Contact' }));
router.get('/legal-requests', (req, res) => res.render('legal/legal-requests', { title: 'Legal requests' }));
router.get('/acknowledgements', (req, res) => res.render('legal/acknowledgements', {
  title: 'Open Source Acknowledgements',
  packages: [
    { name: '@node-rs/argon2', purpose: 'Argon2id password hashing', license: 'MIT', url: 'https://github.com/napi-rs/node-rs' },
    { name: 'ALTCHA', purpose: 'Privacy-preserving email-address obfuscation widgets', license: 'MIT', url: 'https://github.com/altcha-org/altcha' },
    { name: 'ALTCHA Lib', purpose: 'Server-side email-address obfuscation payloads', license: 'MIT', url: 'https://github.com/altcha-org/altcha-lib' },
    { name: 'cookie-parser', purpose: 'HTTP cookie parsing', license: 'MIT', url: 'https://github.com/expressjs/cookie-parser' },
    { name: 'EJS', purpose: 'Escaped server-rendered templates', license: 'Apache-2.0', url: 'https://ejs.co/' },
    { name: 'Express', purpose: 'HTTP application framework', license: 'MIT', url: 'https://expressjs.com/' },
    { name: 'node-postgres', purpose: 'PostgreSQL database client', license: 'MIT', url: 'https://node-postgres.com/' },
    { name: 'qrcode', purpose: 'Authenticator enrollment QR codes', license: 'MIT', url: 'https://github.com/soldair/node-qrcode' },
    { name: 'yazl', purpose: 'Streaming ZIP archive creation', license: 'MIT', url: 'https://github.com/thejoshwolfe/yazl' },
    { name: 'Zod', purpose: 'Configuration and data validation', license: 'MIT', url: 'https://zod.dev/' },
  ],
}));
router.get('/supporters', (req, res) => res.render('legal/supporters', {
  title: 'Supporters',
  supporters: listSupporters(),
  supportLinks: listSupportLinks(),
}));
router.get('/recover', (req, res) => res.render('recover', { title: 'Account recovery' }));
export default router;
