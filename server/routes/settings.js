import express from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

const PERMALINK_RE = /^\/([^\s?]+)?$/;

router.put('/', (req, res) => {
  const body = req.body || {};
  const allowed = ['site_title', 'tagline', 'description', 'posts_per_page', 'permalink', 'active_theme', 'comments_open', 'require_comment_moderation', 'ga_id', 'custom_head_html', 'custom_meta', 'site_path'];
  const errors = [];

  if (body.posts_per_page !== undefined) {
    const n = parseInt(body.posts_per_page, 10);
    if (!(n >= 1 && n <= 100)) return res.status(400).json({ error: 'posts_per_page must be between 1 and 100' });
    body.posts_per_page = String(n);
  }
  if (body.permalink !== undefined && !PERMALINK_RE.test(body.permalink)) {
    return res.status(400).json({ error: 'Permalink must look like /post/:slug' });
  }
  if (body.site_path !== undefined) {
    if (body.site_path === '') {
      body.site_path = '';
    } else if (!/^\/[a-zA-Z0-9._/-]*$/.test(body.site_path)) {
      return res.status(400).json({ error: 'site_path must look like /blog or be empty' });
    } else {
      body.site_path = '/' + body.site_path.replace(/^\/+|\/+$/g, '');
    }
  }

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key) && typeof value === 'string') upsert.run(key, value);
  }
  res.json(db.prepare('SELECT key, value FROM settings ORDER BY key').all().reduce((o, r) => { o[r.key] = r.value; return o; }, {}));
});

export default router;