import express from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin, hashPassword, publicUser } from '../auth.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY username').all();
  const users = rows.map(publicUser).map((u, idx) => {
    u.post_count = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND status != 'trash'").get(rows[idx].id).c;
    return u;
  });
  res.json({ items: users });
});

router.post('/', async (req, res) => {
  const { username, email, password, role } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'Username is required' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['admin', 'editor', 'author'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = await hashPassword(String(password));
  try {
    const result = db.prepare('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      String(username).trim(), email || null, hash, role
    );
    const id = Number(result.lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ user: publicUser(user) });
  } catch {
    res.status(400).json({ error: 'Username already exists' });
  }
});

router.put('/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const { email, role, password } = req.body || {};
  if (role !== undefined && !['admin', 'editor', 'author'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password && String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (role === 'admin' && row.role === 'admin') {
    // Allow keeping admin. The last-admin guard is handled on delete only.
  }
  let hash = row.password_hash;
  if (password) hash = await hashPassword(String(password));
  db.prepare("UPDATE users SET email = ?, password_hash = ?, role = ?, updated_at = datetime('now') WHERE id = ?").run(
    email !== undefined ? email : row.email, hash, role !== undefined ? role : row.role, row.id
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
  res.json({ user: publicUser(user) });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (row.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin user' });
  }
  if (row.id === req.auth.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

export default router;