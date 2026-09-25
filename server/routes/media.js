import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { db } from '../db.js';
import { UPLOADS_DIR } from '../config.js';
import { absUrl } from '../theme.js';
import { requireAuth, requireScope } from '../auth.js';

const router = express.Router();
router.use(requireAuth);
// GET = read scope (API keys can list media); mutate/upload requires 'write'.
router.use((req, res, next) => {
  if (req.method !== 'GET') return requireScope('write')(req, res, next);
  return requireScope('read')(req, res, next);
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^\p{L}\p{N}_ -]+/gu, '').slice(0, 40);
    const name = `${base.replace(/\s+/g, '-') || 'file'}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const allowedTypes = /jpeg|jpg|png|gif|webp|svg|bmp|ico|pdf|txt|md|mp3|mp4|webm|zip|json|csv/;

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okExt = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const okMime = !file.mimetype || /^image\/|^text\/|^application\/pdf$|^audio\/|^video\/|^application\/zip$|^application\/json$|^text\/csv$/.test(file.mimetype);
    cb(null, okExt && okMime);
  },
});

router.get('/', (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const items = db.prepare('SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
  res.json({ items });
});

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded or unsupported file type' });
  const url = absUrl(`/uploads/${req.file.filename}`);
  const result = db.prepare(
    'INSERT INTO media (filename, original_name, mime_type, size, url) VALUES (?, ?, ?, ?, ?)'
  ).run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url);
  res.status(201).json({ id: Number(result.lastInsertRowid), filename: req.file.filename, original_name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size, url, created_at: new Date().toISOString() });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Media not found' });
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, row.filename)); } catch {}
  res.json({ ok: true });
});

export default router;
