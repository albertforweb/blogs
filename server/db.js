import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Older Blogs releases created a local `users` table. Rename it once so the
// remaining rows are clearly legacy authorship data rather than an active
// identity store. Authentication and authorization never read this table.
const hasLegacyUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get('users');
const hasLegacyAuthors = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get('legacy_users');
if (hasLegacyUsers && !hasLegacyAuthors) db.exec('ALTER TABLE users RENAME TO legacy_users');
const legacyUserColumns = db.prepare('PRAGMA table_info(legacy_users)').all().map((column) => column.name);
if (legacyUserColumns.includes('password_hash')) db.exec('ALTER TABLE legacy_users DROP COLUMN password_hash');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      email         TEXT,
      role          TEXT NOT NULL DEFAULT 'editor',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      slug        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      slug       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT NOT NULL,
      slug           TEXT NOT NULL UNIQUE,
      excerpt        TEXT NOT NULL DEFAULT '',
      content        TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'draft',
      category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      author_id      INTEGER REFERENCES legacy_users(id) ON DELETE SET NULL,
      author_subject_id TEXT,
      featured_image TEXT,
      published_at   TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at);

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      filename      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size          INTEGER NOT NULL,
      url           TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      email      TEXT,
      content    TEXT NOT NULL,
      ip         TEXT,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      key_hash    TEXT NOT NULL UNIQUE,
      scopes      TEXT NOT NULL DEFAULT 'read',
      created_by  INTEGER,
      created_by_subject TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const postColumns = db.prepare('PRAGMA table_info(posts)').all().map((column) => column.name);
  if (!postColumns.includes('author_subject_id')) db.exec('ALTER TABLE posts ADD COLUMN author_subject_id TEXT');
  const apiKeyColumns = db.prepare('PRAGMA table_info(api_keys)').all().map((column) => column.name);
  if (!apiKeyColumns.includes('created_by_subject')) db.exec('ALTER TABLE api_keys ADD COLUMN created_by_subject TEXT');

  const settingsCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
  if (settingsCount === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    const defaults = {
      site_title: 'My Blog',
      tagline: 'Just another blogs site',
      description: 'A modern blog powered by Blogs CMS.',
      posts_per_page: '10',
      permalink: '/post/:slug',
      active_theme: 'default',
      comments_open: '1',
      require_comment_moderation: '1',
    };
    for (const [k, v] of Object.entries(defaults)) insert.run(k, v);
  }

  const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (categoryCount === 0) {
    db.prepare('INSERT OR IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)').run(
      'Uncategorized', 'uncategorized', ''
    );
  }
}

initDb();
