import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { PORT, UPLOADS_DIR, ADMIN_DIST, ALLOWED_ORIGINS } from './config.js';
import { db } from './db.js';
import { getSetting, getSettings, getSitePath, absUrl, renderPage } from './theme.js';
import { mdToHtml, htmlToPlainText } from './md.js';

import authRouter from './routes/auth.js';
import postsRouter from './routes/posts.js';
import categoriesRouter from './routes/categories.js';
import tagsRouter from './routes/tags.js';
import mediaRouter from './routes/media.js';
import settingsRouter from './routes/settings.js';
import usersRouter from './routes/users.js';
import commentsRouter from './routes/comments.js';
import themesRouter from './routes/themes.js';
import publicRouter from './routes/public.js';
import keysRouter from './routes/keys.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS for the JSON API and uploads, so other sites' UIs can call blogs directly.
app.use((req, res, next) => {
  const isApi = req.path.startsWith('/api') || req.path.startsWith('/uploads');
  if (!isApi) return next();
  const origin = req.headers.origin;
  if (origin) {
    const wildcard = ALLOWED_ORIGINS.includes('*');
    const allowed = wildcard || ALLOWED_ORIGINS.includes(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', wildcard ? '*' : origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-IAM-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// Strip the configured site_path prefix (e.g. /blog) from request URLs so all
// routes below can stay root-relative while the app still works when a reverse
// proxy forwards /blog/* to this server.
app.use((req, res, next) => {
  const sp = getSitePath();
  if (sp && (req.path === sp || req.path.startsWith(sp + '/'))) {
    req.url = req.url.slice(sp.length) || '/';
  }
  next();
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/users', usersRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/themes', themesRouter);
app.use('/api/public', publicRouter);
app.use('/api/keys', keysRouter);

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', fallthrough: false }));

// ---------------------------------------------------------------------------
// Active theme assets
// ---------------------------------------------------------------------------
import { THEMES_DIR } from './config.js';

function themeAssetsMiddleware(req, res, next) {
  const theme = getSetting('active_theme') || 'default';
  const dir = path.join(THEMES_DIR, theme, 'assets');
  if (!fs.existsSync(dir)) return next();
  return express.static(dir, { maxAge: '1d' })(req, res, next);
}
app.use('/theme-assets', themeAssetsMiddleware);

app.get('/theme.css', (req, res, next) => {
  const theme = getSetting('active_theme') || 'default';
  const candidates = [
    path.join(THEMES_DIR, theme, 'style.css'),
    path.join(THEMES_DIR, theme, 'assets', 'style.css'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      res.set('Content-Type', 'text/css');
      return res.sendFile(c);
    }
  }
  next();
});

// ---------------------------------------------------------------------------
// Admin SPA (registered before the flat-permalink catch-all so it isn't shadowed)
// ---------------------------------------------------------------------------
const adminIndex = path.join(ADMIN_DIST, 'index.html');
let adminIndexHtml = null;
function sendAdminIndex(req, res) {
  if (adminIndexHtml === null) {
    if (!fs.existsSync(adminIndex)) {
      return res.status(503).type('html').send('<h1>Admin panel not built</h1><p>Run <code>npm run build</code> first.</p>');
    }
    adminIndexHtml = fs.readFileSync(adminIndex, 'utf8');
  }
  const sp = getSitePath();
  const html = adminIndexHtml.replace(
    '<head>',
    `<head>\n    <base href="${sp}/admin/" />\n    <script>window.__BLOGS__ = { basePath: ${JSON.stringify(sp)} };</script>`
  );
  res.type('html').send(html);
}

app.use('/admin', express.static(ADMIN_DIST, { index: false, redirect: false }));
app.get('/admin', (req, res, next) => {
  if (req.path !== '/admin') return next();
  res.redirect(absUrl('/admin/'));
});
app.get('/admin/', sendAdminIndex);
app.get('/admin/*', sendAdminIndex);

// ---------------------------------------------------------------------------
// Public site
// ---------------------------------------------------------------------------
const PERMALINK = () => getSetting('permalink') || '/post/:slug';
const postUrl = (slug) => absUrl(PERMALINK().replace(':slug', slug || ''));

function publishedQuery(filters = {}) {
  let where = ["p.status = 'published'"];
  let params = [];
  if (filters.categoryId) { where.push('p.category_id = ?'); params.push(filters.categoryId); }
  if (filters.tagId) { where.push('p.id IN (SELECT post_id FROM post_tags WHERE tag_id = ?)'); params.push(filters.tagId); }
  if (filters.q) { where.push('(p.title LIKE ? OR p.content LIKE ?)'); params.push(`%${filters.q}%`, `%${filters.q}%`); }
  return { where, params };
}

function fetchPublishedPage(filters, page, context) {
  const perPage = Math.max(1, parseInt(getSetting('posts_per_page') || '10', 10));
  const { where, params } = publishedQuery(filters);
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM posts p ${whereSql}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const rows = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, u.username AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN users u ON u.id = p.author_id
     ${whereSql}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ? OFFSET ?`
  ).all(...params, perPage, (page - 1) * perPage);
  const posts = rows.map((row) => ({
    ...row,
    category: row.category_name ? { name: row.category_name, slug: row.category_slug } : null,
    contentHtml: mdToHtml(row.content),
    excerptText: htmlToPlainText(row.excerpt || row.content),
  }));
  for (const p of posts) {
    p.tags = db.prepare(
      'SELECT t.id, t.name, t.slug FROM tags t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = ? ORDER BY t.name'
    ).all(p.id);
  }
  return { posts, total, page, pages, perPage };
}

const pageMeta = (pageTitle, description) => ({
  pageTitle: pageTitle ? `${pageTitle} · ${getSetting('site_title')}` : getSetting('site_title'),
  pageDescription: description || getSetting('description'),
});

// Home
app.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const data = fetchPublishedPage({}, page, {});
  renderPage(res, 'home', {
    ...pageMeta(),
    posts: data.posts,
    total: data.total,
    page: data.page,
    pages: data.pages,
    pagination: { page: data.page, pages: data.pages, baseUrl: '/' },
  });
});

// Single post (default permalink)
app.get('/post/:slug', (req, res) => {
  const post = db.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, u.username AS author_username
     FROM posts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.slug = ? AND p.status = 'published'`
  ).get(req.params.slug);
  if (!post) return renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
  const comments = db.prepare("SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at").all(post.id);
  const prev = db.prepare(
    "SELECT id, title, slug FROM posts WHERE status = 'published' AND (published_at < COALESCE(?, datetime('now'))) AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
  ).get(post.published_at);
  const next = db.prepare(
    "SELECT id, title, slug FROM posts WHERE status = 'published' AND published_at > COALESCE(?, datetime('now')) ORDER BY published_at ASC LIMIT 1"
  ).get(post.published_at);
  renderPage(res, 'post', {
    ...pageMeta(post.title, post.excerpt || post.content),
    post,
    comments,
    commentCount: comments.length,
    commentsOpen: getSetting('comments_open') === '1',
    prevPost: prev ? { ...prev, url: postUrl(prev.slug) } : null,
    nextPost: next ? { ...next, url: postUrl(next.slug) } : null,
    canonical: postUrl(post.slug),
  });
});

// Category listing
app.get('/category/:slug', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const data = fetchPublishedPage({ categoryId: category.id }, page, {});
  renderPage(res, 'category', {
    ...pageMeta(category.name, category.description),
    category,
    posts: data.posts,
    pagination: { page: data.page, pages: data.pages, baseUrl: `/category/${category.slug}` },
  });
});

// Tag listing
app.get('/tag/:slug', (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE slug = ?').get(req.params.slug);
  if (!tag) return renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const data = fetchPublishedPage({ tagId: tag.id }, page, {});
  renderPage(res, 'tag', {
    ...pageMeta(tag.name),
    tag,
    posts: data.posts,
    pagination: { page: data.page, pages: data.pages, baseUrl: `/tag/${tag.slug}` },
  });
});

// Search
app.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const data = fetchPublishedPage({ q }, page, {});
  renderPage(res, 'search', {
    ...pageMeta(`Search: ${q || 'all'}`),
    q,
    posts: data.posts,
    total: data.total,
    pagination: { page: data.page, pages: data.pages, baseUrl: `/search?q=${encodeURIComponent(q)}` },
  });
});

// ---------------------------------------------------------------------------
// SEO: RSS + sitemap (registered before the catch-all so they are never shadowed)
// ---------------------------------------------------------------------------
const nowDate = () => new Date().toUTCString();
const url = (u) => absUrl(u);

app.get('/rss.xml', (req, res) => {
  const posts = db.prepare(
    "SELECT * FROM posts WHERE status = 'published' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 50"
  ).all();
  const items = posts.map((p) => {
    const contentText = htmlToPlainText(mdToHtml(p.content));
    const desc = htmlToPlainText(p.excerpt || p.content).slice(0, 500);
    return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(url(postUrl(p.slug)))}</link>
      <guid isPermaLink="true">${esc(url(postUrl(p.slug)))}</guid>
      <pubDate>${new Date(String(p.published_at).replace(' ', 'T') + 'Z').toUTCString()}</pubDate>
      <description>${esc(desc)}</description>
      <content:encoded>${esc(contentText)}</content:encoded>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(getSetting('site_title'))}</title>
    <link>${esc(url('/'))}</link>
    <description>${esc(getSetting('tagline'))}</description>
    <language>en</language>
    <lastBuildDate>${nowDate()}</lastBuildDate>
${items}
  </channel>
</rss>`;
  res.type('application/rss+xml').send(xml);
});

app.get('/sitemap.xml', (req, res) => {
  const posts = db.prepare("SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY published_at DESC").all();
  const categories = db.prepare('SELECT slug FROM categories').all();
  const tags = db.prepare('SELECT slug FROM tags').all();
  const locs = [{ loc: '/', prio: '1.0' }];
  for (const c of categories) locs.push({ loc: `/category/${c.slug}`, prio: '0.6' });
  for (const t of tags) locs.push({ loc: `/tag/${t.slug}`, prio: '0.5' });
  for (const p of posts) locs.push({ loc: postUrl(p.slug), prio: '0.8', lastmod: p.updated_at });

  const body = locs.map((l) => {
    const lastmod = l.lastmod ? `\n    <lastmod>${new Date(String(l.lastmod).replace(' ', 'T') + 'Z').toISOString()}</lastmod>` : '';
    return `  <url>
    <loc>${esc(url(l.loc))}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>${l.prio}</priority>
  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
  res.type('application/xml').send(xml);
});

// ---------------------------------------------------------------------------
// Custom permalink: /:slug (e.g. flat permalinks) — registered last on purpose
// ---------------------------------------------------------------------------
const RESERVED_SLUGS = new Set(['admin', 'api', 'uploads', 'theme-assets', 'theme.css', 'search', 'category', 'tag', 'post', 'rss.xml', 'sitemap.xml', 'favicon.ico', 'robots.txt']);
app.get('/:slug', (req, res) => {
  if (PERMALINK() !== '/:slug' || RESERVED_SLUGS.has(req.params.slug)) {
    return renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
  }
  const post = db.prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug, u.username AS author_username
       FROM posts p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug = ? AND p.status = 'published'`
    ).get(req.params.slug);
  if (!post) return renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
  const comments = db.prepare("SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at").all(post.id);
  renderPage(res, 'post', {
    ...pageMeta(post.title, post.excerpt || post.content),
    post,
    comments,
    commentCount: comments.length,
    commentsOpen: getSetting('comments_open') === '1',
    prevPost: null,
    nextPost: null,
    canonical: postUrl(post.slug),
  });
});

// ---------------------------------------------------------------------------
// SEO: RSS + sitemap
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 404 + errors
// ---------------------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  renderPage(res, 'notfound', { ...pageMeta('404', 'Not found') }, 404);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large (max 20MB)' });
  }
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
  res.status(404).type('html').send('<h1>404</h1><p>Not found</p>');
});

app.listen(PORT, () => {
  console.log(`Blogs CMS listening on http://localhost:${PORT}`);
  console.log(`  Admin panel: http://localhost:${PORT}/admin/`);
  console.log(`  Public site: http://localhost:${PORT}/`);
  console.log(`  (override the port with PORT=<number>; build the admin panel first with: npm run build)`);
});