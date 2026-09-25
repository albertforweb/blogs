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
    `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS post_count
     FROM categories c ORDER BY c.name`
  ).all();
}

router.get('/', (req, res) => {
  res.json({ items: listWithCounts() });
});

router.post('/', canManage, (req, res) => {
  const { name, slug, description, parent_id } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const madeSlug = slugify(slug || name);
  try {
    const result = db.prepare(
      'INSERT INTO categories (name, slug, description, parent_id) VALUES (?, ?, ?, ?)'
    ).run(String(name).trim(), madeSlug, description || '', parent_id || null);
    res.status(201).json({ id: Number(result.lastInsertRowid), name: String(name).trim(), slug: madeSlug, description: description || '', parent_id: parent_id || null, post_count: 0 });
  } catch (err) {
    res.status(400).json({ error: 'Category with this name/slug already exists' });
  }
});

router.put('/:id', canManage, (req, res) => {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Category not found' });
  const { name, slug, description, parent_id } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const newName = name !== undefined ? String(name).trim() : row.name;
  const newSlug = slug !== undefined ? slugify(slug) : row.slug;
  try {
    db.prepare('UPDATE categories SET name = ?, slug = ?, description = ?, parent_id = ? WHERE id = ?').run(
      newName, newSlug, description !== undefined ? description : row.description,
      parent_id !== undefined ? parent_id : row.parent_id, row.id
    );
    res.json({ ...row, name: newName, slug: newSlug, description: description !== undefined ? description : row.description, parent_id: parent_id !== undefined ? parent_id : row.parent_id });
  } catch {
    res.status(400).json({ error: 'Category with this name/slug already exists' });
  }
});

router.delete('/:id', canManage, (req, res) => {
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

export default router;
