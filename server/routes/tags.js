import express from 'express';
import { db } from '../db.js';
import { slugify } from '../slugify.js';
import { requireAuth } from '../auth.js';

const router = express.Router();
router.use(requireAuth);

function canManage(req, res, next) {
  const a = req.auth;
  if (a.type === 'jwt') {
    if (a.user?.role !== 'admin' && a.user?.role !== 'editor') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    return next();
  }
  if (a.type === 'iam' && (a.user?.permissions || []).some((permission) => ['blogs:post:create', 'blogs:post:update', 'blogs:settings:manage'].includes(permission))) return next();
  if ((a.scopes || []).includes('write')) return next();
  return res.status(403).json({ error: "API key lacks 'write' scope" });
}

function listWithCounts() {
  return db.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id WHERE pt.tag_id = t.id AND p.status = 'published') AS post_count
     FROM tags t ORDER BY t.name`
  ).all();
}

router.get('/', (req, res) => {
  res.json({ items: listWithCounts() });
});

router.post('/', canManage, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const madeSlug = slugify(name);
  try {
    const result = db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').run(String(name).trim(), madeSlug);
    res.status(201).json({ id: Number(result.lastInsertRowid), name: String(name).trim(), slug: madeSlug, post_count: 0 });
  } catch {
    res.status(400).json({ error: 'Tag with this name already exists' });
  }
});

router.put('/:id', canManage, (req, res) => {
  const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tag not found' });
  const { name, slug } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const newName = name !== undefined ? String(name).trim() : row.name;
  const newSlug = slug !== undefined ? slugify(slug) : row.slug;
  try {
    db.prepare('UPDATE tags SET name = ?, slug = ? WHERE id = ?').run(newName, newSlug, row.id);
    res.json({ ...row, name: newName, slug: newSlug, post_count: row.post_count || 0 });
  } catch {
    res.status(400).json({ error: 'Tag with this name already exists' });
  }
});

router.delete('/:id', canManage, (req, res) => {
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Tag not found' });
  res.json({ ok: true });
});

export default router;
