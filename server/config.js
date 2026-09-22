import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT_DIR, 'uploads');
export const THEMES_DIR = path.join(ROOT_DIR, 'themes');
export const ADMIN_DIST = path.join(ROOT_DIR, 'admin', 'dist');
export const DB_PATH = path.join(DATA_DIR, 'blogs.db');
export const PORT = Number(process.env.PORT || 4000);

// CORS for the JSON API (/api and /uploads). Comma-separated origins, or '*' for any.
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Optional IAM token introspection. When IAM_INTROSPECT_URL is set, requests that carry
// the IAM_INTROSPECT_HEADER are exchanged with that service for a user account instead of a
// local JWT / API key. Off by default so blogs stays fully self-contained.
export const IAM_INTROSPECT_URL = process.env.IAM_INTROSPECT_URL || '';
export const IAM_INTROSPECT_HEADER = (process.env.IAM_INTROSPECT_HEADER || 'x-iam-token').toLowerCase();
export const IAM_INTROSPECT_TIMEOUT = Number(process.env.IAM_INTROSPECT_TIMEOUT || 5000);
export const IAM_INTROSPECT_SECRET = process.env.IAM_INTROSPECT_SECRET || '';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  ensureDir(DATA_DIR);
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, secret);
  return secret;
}

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

export { crypto };