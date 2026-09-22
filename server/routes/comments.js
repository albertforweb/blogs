import express from 'express';
import { db } from '../db.js';
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
  if ((a.scopes || []).includes('write')) return next();
  return res.status(403).json({ error: "API key lacks 'write' scope" });
}

router.get('/', (req, res) => {
  const status = req.query.status;
  const postId = req.query.post_id;
  let where = [];
  let params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (postId) { where.push('post_id = ?'); params.push(postId); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT cm.*, p.title AS post_title, p.slug AS post_slug
     FROM comments cm LEFT JOIN posts p ON p.id = cm.post_id
     ${whereSql}
     ORDER BY cm.created_at DESC LIMIT 200`
  ).all(...params);
  res.json({ items: rows });
});

router.patch('/:id', canManage, (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'spam', 'trash'].includes(status)) {
    return res.status(400).json({ error: 'Invalid comment status' });
  }
  const result = db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Comment not found' });
  res.json({ ok: true });
});

router.delete('/:id', canManage, (req, res) => {
  const result = db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Comment not found' });
  res.json({ ok: true });
});

export default router;