import express from 'express';
import fs from 'node:fs';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { listThemes, themeFilePath, listThemeFiles, invalidateThemeCache } from '../theme.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json({ items: listThemes() });
});

router.post('/:name/activate', (req, res) => {
  const theme = req.params.name;
  const exists = listThemes().some((t) => t.name === theme);
  if (!exists) return res.status(404).json({ error: 'Theme not found' });
  db.prepare("UPDATE settings SET value = ? WHERE key = 'active_theme'").run(theme);
  invalidateThemeCache();
  res.json({ ok: true, active_theme: theme });
});

router.get('/:name/files', (req, res) => {
  const theme = req.params.name;
  if (!listThemes().some((t) => t.name === theme)) return res.status(404).json({ error: 'Theme not found' });
  res.json({ items: listThemeFiles(theme) });
});

router.get('/:name/file/:path(*)', (req, res) => {
  try {
    const filePath = themeFilePath(req.params.name, req.params.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ path: req.params.path, content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:name/file/:path(*)', (req, res) => {
  try {
    const filePath = themeFilePath(req.params.name, req.params.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    if (req.body?.content === undefined) return res.status(400).json({ error: 'content is required' });
    fs.writeFileSync(filePath, String(req.body.content));
    invalidateThemeCache();
    res.json({ ok: true, path: req.params.path });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:name/create', (req, res) => {
  const { path: relPath, content } = req.body || {};
  if (!relPath || !/\.(hbs|css)$/i.test(relPath)) {
    return res.status(400).json({ error: 'Only .hbs and .css files can be created' });
  }
  const list = listThemes();
  if (!list.some((t) => t.name === req.params.name)) return res.status(404).json({ error: 'Theme not found' });
  try {
    const filePath = themeFilePath(req.params.name, relPath);
    if (fs.existsSync(filePath)) return res.status(400).json({ error: 'File already exists' });
    fs.writeFileSync(filePath, content || '');
    invalidateThemeCache();
    res.status(201).json({ ok: true, path: relPath });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:name/file/:path(*)', (req, res) => {
  const list = listThemes();
  if (!list.some((t) => t.name === req.params.name)) return res.status(404).json({ error: 'Theme not found' });
  try {
    const filePath = themeFilePath(req.params.name, req.params.path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    invalidateThemeCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;