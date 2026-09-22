import express from 'express';
import { db } from '../db.js';
import { verifyPassword, signToken, publicUser, requireAuth, hashPassword, verifyPassword as checkPassword } from '../auth.js';

// /me and /password operate on a local user account, so only JWT logins (not API keys / IAM).
function requireJwtUser(req, res, next) {
  if (req.auth?.type !== 'jwt' || !req.auth.user?.id) {
    return res.status(401).json({ error: 'Local account login required' });
  }
  next();
}

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, requireJwtUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

router.put('/password', requireAuth, requireJwtUser, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.user.id);
  if (!verifyPassword(current_password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const hash = await hashPassword(new_password);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.auth.user.id);
  res.json({ ok: true });
});

export default router;