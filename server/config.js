import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT_DIR, 'uploads');
export const THEMES_DIR = path.join(ROOT_DIR, 'themes');
export const ADMIN_DIST = path.join(ROOT_DIR, 'admin', 'dist');
export const DB_PATH = path.join(DATA_DIR, 'blogs.db');
export const PORT = Number(process.env.PORT || 4000);
// Optional public path used when the CMS is mounted behind a reverse proxy
// (for example, /blog). A value stored in the settings table still takes
// precedence once the application has initialized.
export const SITE_PATH = process.env.SITE_PATH || '';

// CORS for the JSON API (/api and /uploads). Comma-separated origins, or '*' for any.
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map((s) => s.trim()).filter(Boolean);

// IAM is the Blogs authentication authority. The introspection endpoint is
// used for bearer tokens and the short-lived OIDC-backed Blogs session.
export const IAM_INTROSPECT_URL = process.env.IAM_INTROSPECT_URL || '';
export const IAM_INTROSPECT_HEADER = (process.env.IAM_INTROSPECT_HEADER || 'authorization').toLowerCase();
export const IAM_INTROSPECT_TIMEOUT = Number(process.env.IAM_INTROSPECT_TIMEOUT || 5000);
export const IAM_INTROSPECT_SECRET = process.env.IAM_INTROSPECT_SECRET || '';

// Optional application-owned authorization manifest registration. When the
// manifest URL is configured, startup reconciliation is required by default.
export const IAM_MANIFEST_URL = process.env.IAM_MANIFEST_URL || '';
export const IAM_CLIENT_ID = process.env.IAM_CLIENT_ID || 'blogs-api';
function readIamClientSecret() {
  const vaultFile = process.env.IAM_VAULTS_FILE || '';
  if (!vaultFile) return '';
  try {
    const vault = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
    return vault?.clients?.[IAM_CLIENT_ID]?.clientSecret || '';
  } catch {
    return '';
  }
}

// IAM_CLIENT_SECRET is preferred for normal deployments. Reading the
// bootstrap vault is a local-compose convenience so Blogs can reconcile its
// manifest without copying a generated secret into another .env file.
export const IAM_CLIENT_SECRET = process.env.IAM_CLIENT_SECRET || readIamClientSecret();
export const IAM_INTROSPECT_CLIENT_ID = process.env.IAM_INTROSPECT_CLIENT_ID || IAM_CLIENT_ID;
export const IAM_ISSUER = process.env.IAM_ISSUER || 'http://localhost:8080/iam';
export const IAM_AUTHORIZATION_URL = process.env.IAM_AUTHORIZATION_URL || `${IAM_ISSUER}/oauth/authorize`;
export const IAM_TOKEN_URL = process.env.IAM_TOKEN_URL || 'http://iam:3000/oauth/token';
export const IAM_REVOKE_URL = process.env.IAM_REVOKE_URL || 'http://iam:3000/oauth/revoke';
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const IAM_CALLBACK_URL = process.env.IAM_CALLBACK_URL || `${PUBLIC_BASE_URL}/api/auth/callback`;
export const BLOGS_SESSION_COOKIE = process.env.BLOGS_SESSION_COOKIE || 'blogs_session';
export const BLOGS_COOKIE_SECURE = process.env.BLOGS_COOKIE_SECURE === 'true'
  || (process.env.NODE_ENV === 'production' && process.env.BLOGS_ALLOW_INSECURE_HTTP !== 'true');
export const IAM_MANIFEST_VERSION = process.env.IAM_MANIFEST_VERSION || '1.0.0';
export const IAM_REGISTRATION_TIMEOUT = Number(process.env.IAM_REGISTRATION_TIMEOUT || 5000);
export const IAM_REGISTRATION_REQUIRED = process.env.IAM_REGISTRATION_REQUIRED !== 'false';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);
