import express from 'express';
import { db } from '../db.js';
import { slugify, uniqueSlug } from '../slugify.js';
import { requireAuth, requireScope } from '../auth.js';
import { mdToHtml } from '../md.js';

const router = express.Router();
router.use(requireAuth);
// Reads and mutations are both checked. An authenticated IAM token without a
// Blogs permission must not become a general-purpose Blogs session.
router.use((req, res, next) => {
  if (req.method !== 'GET') return requireScope('write')(req, res, next);
  return requireScope('read')(req, res, next);
});

function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    status: row.status,
    category_id: row.category_id,
    category: row.category_name ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
    author_id: row.author_id,
    author: row.author_username || row.author_subject_id
      ? { id: row.author_id ?? row.author_subject_id, username: row.author_username || null }
      : null,
    author_subject_id: row.author_subject_id || null,
    featured_image: row.featured_image,
    published_at: row.published_at,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

function tagsForPost(postId) {
  return db.prepare(
    `SELECT t.id, t.name, t.slug FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ? ORDER BY t.name`
  ).all(postId);
}

function fillTags(posts) {
  for (const p of posts) p.tags = tagsForPost(p.id);
  return posts;
}

function syncTags(postId, tags = []) {
  db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);
  const find = db.prepare('SELECT id FROM tags WHERE name = ?');
  const findSlug = db.prepare('SELECT id FROM tags WHERE slug = ?');
  const create = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
  const link = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
  for (const t of tags) {
    const name = String(typeof t === 'object' ? (t.name || t.slug) : t).trim();
    if (!name) continue;
    const slug = slugify(name);
    let tag = slug ? findSlug.get(slug) : null;
    if (!tag) { create.run(name, slug); tag = findSlug.get(slug); }
    if (tag) link.run(postId, tag.id);
  }
}

function slugExists(slug, excludeId = null) {
  const row = excludeId
    ? db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(slug, excludeId)
    : db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  return !!row;
}

function buildListQuery(filters) {
  let where = [];
  let params = [];
  if (filters.status && filters.status !== 'any') {
    where.push('p.status = ?');
    params.push(filters.status);
  }
  if (filters.q) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.category_id) {
    where.push('p.category_id = ?');
    params.push(Number(filters.category_id));
  }
  if (filters.tag_id) {
    where.push('p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ?)');
    params.push(Number(filters.tag_id));
  }
  return { where, params };
}

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filters = buildListQuery({ status: req.query.status, q: req.query.q, category_id: req.query.category_id, tag_id: req.query.tag_id });

  const whereSql = filters.where.length ? 'WHERE ' + filters.where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM posts p ${whereSql}`).get(...filters.params).c;

  const rows = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, COALESCE(u.username, p.author_subject_id) AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN legacy_users u ON u.id = p.author_id
     ${whereSql}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ? OFFSET ?`
  ).all(...filters.params, limit, (page - 1) * limit);

  const items = fillTags(rows.map(rowToPost));
  res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
});

router.get('/counts', (req, res) => {
  const stats = {};
  for (const status of ['draft', 'published', 'trash']) {
    stats[status] = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE status = ?').get(status).c;
  }
  stats.total = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
  stats.pending_comments = db.prepare("SELECT COUNT(*) AS c FROM comments WHERE status = 'pending'").get().c;
  stats.tags = db.prepare('SELECT COUNT(*) AS c FROM tags').get().c;
  stats.categories = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  stats.media = db.prepare('SELECT COUNT(*) AS c FROM media').get().c;
  res.json(stats);
});

router.get('/recent', (req, res) => {
  const rows = db.prepare(
    `SELECT p.id, p.title, p.slug, p.status, p.published_at, COALESCE(u.username, p.author_subject_id) AS author_username
     FROM posts p LEFT JOIN legacy_users u ON u.id = p.author_id
     ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT ?`
  ).all(Math.min(20, parseInt(req.query.limit, 10) || 5));
  res.json({ items: rows });
});

router.post('/preview', (req, res) => {
  const html = mdToHtml(req.body?.content || '');
  res.json({ html });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, COALESCE(u.username, p.author_subject_id) AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN legacy_users u ON u.id = p.author_id
     WHERE p.id = ?`
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const post = rowToPost(row);
  post.tags = tagsForPost(post.id);
  res.json(post);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const slug = uniqueSlug(b.slug || b.title, (s) => slugExists(s));
  const status = ['draft', 'published', 'trash'].includes(b.status) ? b.status : 'draft';
  let publishedAt = b.published_at || null;
  if (status === 'published' && !publishedAt) publishedAt = new Date().toISOString();

  const authorId = Number.isInteger(req.auth?.user?.id) ? req.auth.user.id : null;
  const authorSubjectId = req.auth?.type === 'iam' ? String(req.auth.user.id) : null;
  const result = db.prepare(
    `INSERT INTO posts (title, slug, excerpt, content, status, category_id, author_id, author_subject_id, featured_image, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    b.title.trim(), slug, b.excerpt || '', b.content || '', status,
    b.category_id || null, authorId, authorSubjectId, b.featured_image || null, publishedAt
  );

  const postId = Number(result.lastInsertRowid);
  syncTags(postId, b.tags || []);
  const row = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, COALESCE(u.username, p.author_subject_id) AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN legacy_users u ON u.id = p.author_id WHERE p.id = ?`
  ).get(postId);
  const post = rowToPost(row);
  post.tags = tagsForPost(post.id);
  res.status(201).json(post);
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const b = req.body || {};
  if (b.title !== undefined && !String(b.title).trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const title = b.title !== undefined ? String(b.title).trim() : row.title;
  let slug = row.slug;
  if (b.slug !== undefined && String(b.slug).trim()) {
    slug = uniqueSlug(String(b.slug).trim(), (s) => slugExists(s, row.id));
  } else if (b.title !== undefined && (b.regenerate_slug || !row.slug)) {
    slug = uniqueSlug(title, (s) => slugExists(s, row.id));
  }

  const status = b.status !== undefined ? (['draft', 'published', 'trash'].includes(b.status) ? b.status : row.status) : row.status;
  let publishedAt = b.published_at !== undefined ? b.published_at : row.published_at;
  if (status === 'published' && !publishedAt) publishedAt = new Date().toISOString();

  db.prepare(
    `UPDATE posts SET title = ?, slug = ?, excerpt = ?, content = ?, status = ?, category_id = ?,
     featured_image = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    title, slug,
    b.excerpt !== undefined ? b.excerpt : row.excerpt,
    b.content !== undefined ? b.content : row.content,
    status,
    b.category_id !== undefined ? b.category_id : row.category_id,
    b.featured_image !== undefined ? b.featured_image : row.featured_image,
    publishedAt,
    row.id
  );

  if (b.tags !== undefined) syncTags(row.id, b.tags);
  const updated = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, COALESCE(u.username, p.author_subject_id) AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN legacy_users u ON u.id = p.author_id WHERE p.id = ?`
  ).get(row.id);
  const post = rowToPost(updated);
  post.tags = tagsForPost(post.id);
  res.json(post);
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

export default router;
