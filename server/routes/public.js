import express from 'express';
import { db } from '../db.js';
import { getSetting, absUrl } from '../theme.js';
import { mdToHtml } from '../md.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Comments (public, unauthenticated — spambot honeypot included)
// ---------------------------------------------------------------------------

router.post('/comments', (req, res) => {
  const body = req.body || {};
  const honeypot = body.website || body.url || body.homepage;
  if (honeypot) return res.status(200).json({ ok: true, flagged: true });

  const post = db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").get(body.post_id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (getSetting('comments_open') !== '1') {
    return res.status(403).json({ error: 'Comments are closed' });
  }
  const author = String(body.author || '').trim();
  const content = String(body.content || '').trim();
  if (!author || !content) return res.status(400).json({ error: 'Name and comment are required' });
  if (content.length > 2000) return res.status(400).json({ error: 'Comment is too long' });

  const moderated = getSetting('require_comment_moderation') === '1';
  const status = moderated ? 'pending' : 'approved';
  const result = db.prepare(
    'INSERT INTO comments (post_id, author, email, content, ip, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(post.id, author.slice(0, 100), body.email ? String(body.email).slice(0, 150) : null, content, req.ip, status);

  res.status(201).json({
    ok: true,
    id: Number(result.lastInsertRowid),
    status,
    message: status === 'pending' ? 'Thank you! Your comment is awaiting moderation.' : 'Thank you! Your comment has been posted.',
  });
});

// ---------------------------------------------------------------------------
// Public read API — published content as JSON, no authentication required.
// Can be consumed from any origin / server to build your own UI on top of blogs.
// ---------------------------------------------------------------------------

const POST_SELECT = `SELECT p.*, 
  c.name AS category_name, c.slug AS category_slug,
  COALESCE(u.username, p.author_subject_id) AS author_username,
  (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id AND cm.status = 'approved') AS comment_count
 FROM posts p
 LEFT JOIN categories c ON c.id = p.category_id
 LEFT JOIN legacy_users u ON u.id = p.author_id`;

function publicPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    contentHtml: mdToHtml(row.content),
    status: row.status,
    category: row.category_name ? { id: row.category_id, name: row.category_name, slug: row.category_slug } : null,
    author: row.author_username || null,
    featured_image: row.featured_image,
    comment_count: row.comment_count || 0,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function tagsForPost(postId) {
  return db.prepare(
    `SELECT t.id, t.name, t.slug FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ? ORDER BY t.name`
  ).all(postId);
}

router.get('/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 10));

  const where = ["p.status = 'published'", 'p.published_at IS NOT NULL'];
  const params = [];
  if (req.query.category) { where.push('c.slug = ?'); params.push(String(req.query.category)); }
  if (req.query.tag) {
    where.push('p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)');
    params.push(String(req.query.tag));
  }
  if (req.query.q) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const q = `%${String(req.query.q)}%`;
    params.push(q, q);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) AS c FROM posts p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / perPage));

  const rows = db.prepare(
    `${POST_SELECT} ${whereSql} ORDER BY p.published_at DESC LIMIT ? OFFSET ?`
  ).all(...params, perPage, (page - 1) * perPage);
  const items = rows.map((r) => { const post = publicPost(r); post.tags = tagsForPost(post.id); return post; });

  res.json({ items, total, page, pages, per_page: perPage });
});

router.get('/posts/:slug', (req, res) => {
  const row = db.prepare(
    `${POST_SELECT} WHERE p.slug = ? AND p.status = 'published' AND p.published_at IS NOT NULL`
  ).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Post not found' });
  const post = publicPost(row);
  post.tags = tagsForPost(post.id);
  const comments = row.comment_count > 0
    ? db.prepare("SELECT id, author, content, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at").all(post.id)
    : [];
  res.json({ ...post, comments });
});

router.get('/categories', (req, res) => {
  const items = db.prepare(
    `SELECT c.id, c.name, c.slug, c.description, c.parent_id,
            (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS post_count
     FROM categories c ORDER BY c.name`
  ).all();
  res.json({ items });
});

router.get('/tags', (req, res) => {
  const items = db.prepare(
    `SELECT t.id, t.name, t.slug,
            (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id WHERE pt.tag_id = t.id AND p.status = 'published') AS post_count
     FROM tags t ORDER BY t.name`
  ).all();
  res.json({ items });
});

router.get('/info', (req, res) => {
  const settings = {
    site_title: getSetting('site_title'),
    tagline: getSetting('tagline'),
    description: getSetting('description'),
    permalink: getSetting('permalink'),
    posts_per_page: getSetting('posts_per_page'),
    comments_open: getSetting('comments_open') === '1',
    site_path: getSetting('site_path') || '',
    rss: absUrl('/rss.xml'),
    sitemap: absUrl('/sitemap.xml'),
  };
  res.json(settings);
});

export default router;
