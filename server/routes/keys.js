import express from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, generateApiKey } from '../auth.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

const SCOPES = ['read', 'write'];

function normalizeScopes(scopes) {
  const set = new Set();
  for (const s of (Array.isArray(scopes) ? scopes : [])) {
    if (SCOPES.includes(String(s))) set.add(String(s));
  }
  // Every key can at least read; write implies read for the admin UI story but scopes are
  // enforced literally by the middleware, so default to ['read'].
  if (!set.size) set.add('read');
  return [...set];
}

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT k.id, k.name, k.scopes, k.created_by, k.created_by_subject, k.created_at, k.last_used_at, k.revoked, u.username AS created_by_username
     FROM api_keys k LEFT JOIN legacy_users u ON u.id = k.created_by
     ORDER BY k.created_at DESC`
  ).all();
  res.json({ items: rows });
});

router.post('/', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const scopes = normalizeScopes((req.body || {}).scopes);
  const { raw, hash } = generateApiKey();
  const result = db.prepare(
    'INSERT INTO api_keys (name, key_hash, scopes, created_by, created_by_subject) VALUES (?, ?, ?, ?, ?)'
  ).run(
    name,
    hash,
    scopes.join(','),
    Number.isInteger(req.auth?.user?.id) ? req.auth.user.id : null,
    req.auth?.type === 'iam' ? String(req.auth.user.id) : null,
  );
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    name,
    scopes,
    // The raw key is only ever returned once, at creation time.
    key: raw,
  });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'API key not found' });
  const body = req.body || {};
  const updates = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    updates.name = name;
  }
  if (body.scopes !== undefined) {
    updates.scopes = normalizeScopes(body.scopes).join(',');
  }
  if (body.revoked !== undefined) {
    updates.revoked = body.revoked ? 1 : 0;
  }
  if (Object.keys(updates).length) {
    const cols = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE api_keys SET ${cols} WHERE id = ?`).run(...Object.values(updates), row.id);
  }
  res.json(db.prepare('SELECT id, name, scopes, revoked FROM api_keys WHERE id = ?').get(row.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'API key not found' });
  res.json({ ok: true });
});

export default router;
