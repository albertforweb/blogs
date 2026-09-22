import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import {
  getJwtSecret,
  IAM_INTROSPECT_URL,
  IAM_INTROSPECT_HEADER,
  IAM_INTROSPECT_TIMEOUT,
  IAM_INTROSPECT_SECRET,
} from './config.js';
import { db } from './db.js';

const TOKEN_TTL = '7d';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: TOKEN_TTL,
  });
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  };
}

// ---------------------------------------------------------------------------
// API keys (for external apps consuming the REST API server-to-server)
// ---------------------------------------------------------------------------

export function apiKeyHash(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function generateApiKey() {
  const raw = `blogs_${crypto.randomBytes(24).toString('base64url')}`;
  return { raw, hash: apiKeyHash(raw) };
}

export function isValidApiKey(raw) {
  if (!raw || typeof raw !== 'string' || raw.length < 16) return false;
  const row = db.prepare(
    'SELECT id, name, scopes FROM api_keys WHERE key_hash = ? AND revoked = 0'
  ).get(apiKeyHash(raw));
  if (!row) return false;
  db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  return { id: row.id, type: 'apikey', scopes: row.scopes.split(',').filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Optional IAM token introspection (off unless IAM_INTROSPECT_URL is set)
// ---------------------------------------------------------------------------

async function introspectIam(requestHeaders) {
  if (!IAM_INTROSPECT_URL) return null;
  const token = requestHeaders[IAM_INTROSPECT_HEADER];
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IAM_INTROSPECT_TIMEOUT);
  try {
    const res = await fetch(IAM_INTROSPECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(IAM_INTROSPECT_SECRET ? { Authorization: `Bearer ${IAM_INTROSPECT_SECRET}` } : {}),
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.active === false) return null;
    let role = String(data.role || 'subscriber').toLowerCase();
    if (!['admin', 'editor', 'author', 'subscriber'].includes(role)) role = 'subscriber';
    return {
      type: 'iam',
      scopes: ['read'],
      user: {
        id: data.sub != null ? `iam:${data.sub}` : null,
        username: data.username || data.email || data.sub || 'iam-user',
        email: data.email || null,
        role,
        iam: true,
        name: data.name || null,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Resolves authentication from (in order): local JWT, API key, IAM token.
// Sets req.auth = { type, user?, scopes? } or null. Does not block unauthenticated requests.
export async function resolveAuth(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (bearer) {
    try {
      const user = jwt.verify(bearer, getJwtSecret());
      return { type: 'jwt', user, scopes: ['read', 'write'] };
    } catch {
      const key = isValidApiKey(bearer);
      if (key) return { type: 'apikey', key, scopes: key.scopes };
    }
  } else {
    const key = isValidApiKey(req.headers['x-api-key']);
    if (key) return { type: 'apikey', key, scopes: key.scopes };
  }

  const iam = await introspectIam(req.headers);
  if (iam) return iam;

  return null;
}

export function requireAuth(req, res, next) {
  resolveAuth(req)
    .then((auth) => {
      if (!auth) return res.status(401).json({ error: 'Authentication required' });
      req.auth = auth;
      return next();
    })
    .catch(() => res.status(401).json({ error: 'Authentication required' }));
}

export function requireAdmin(req, res, next) {
  const role = req.auth?.type === 'jwt' ? req.auth.user?.role : null;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

const JWT_WRITE_ROLES = new Set(['admin', 'editor', 'author']);

// A scope guard for API keys / IAM tokens. Local JWTs (logged-in users) are always allowed.
export function requireScope(scope) {
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'Authentication required' });
    if (auth.type === 'jwt') {
      if (scope === 'read') return next();
      return JWT_WRITE_ROLES.has(auth.user?.role)
        ? next()
        : res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (auth.type === 'apikey' && (auth.scopes || []).includes(scope)) return next();
    if (auth.type === 'iam') {
      if (scope === 'read') return next();
      if (JWT_WRITE_ROLES.has(auth.user?.role)) return next();
    }
    return res.status(403).json({ error: `API key lacks '${scope}' scope` });
  };
}