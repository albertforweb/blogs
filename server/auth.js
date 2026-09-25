import crypto from 'node:crypto';
import {
  IAM_INTROSPECT_URL,
  IAM_INTROSPECT_TIMEOUT,
  IAM_INTROSPECT_SECRET,
  IAM_CLIENT_ID,
  IAM_CLIENT_SECRET,
  IAM_INTROSPECT_CLIENT_ID,
  IAM_TOKEN_URL,
  IAM_REVOKE_URL,
  BLOGS_SESSION_COOKIE,
  BLOGS_COOKIE_SECURE,
} from './config.js';
import { db } from './db.js';

const loginStates = new Map();
const sessions = new Map();
const LOGIN_STATE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;

function parseCookies(raw) {
  return String(raw || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function cookieOptions(maxAge) {
  return [
    `${BLOGS_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(BLOGS_COOKIE_SECURE ? ['Secure'] : []),
    ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]),
  ].join('; ');
}

export function sessionFromRequest(req) {
  const sessionId = parseCookies(req.headers.cookie)[BLOGS_SESSION_COOKIE];
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { ...session, sessionId };
}

export function setSessionCookie(res, tokenSet) {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  sessions.set(sessionId, {
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token || null,
    accessExpiresAt: Date.now() + Number(tokenSet.expires_in || 3600) * 1000,
    expiresAt: Date.now() + SESSION_TTL,
  });
  res.setHeader('Set-Cookie', cookieOptions(Math.floor(SESSION_TTL / 1000)).replace(`${BLOGS_SESSION_COOKIE}=`, `${BLOGS_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`));
  return sessionId;
}

export function clearSessionCookie(req, res) {
  const session = sessionFromRequest(req);
  if (session) sessions.delete(session.sessionId);
  res.setHeader('Set-Cookie', cookieOptions(0));
  return session;
}

export async function revokeIamToken(token) {
  if (!token || !IAM_CLIENT_SECRET) return;
  try {
    const basic = `Basic ${Buffer.from(`${IAM_INTROSPECT_CLIENT_ID}:${IAM_CLIENT_SECRET}`, 'utf8').toString('base64')}`;
    await fetch(IAM_REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Local session removal still succeeds if IAM is temporarily unavailable.
  }
}

export function createLoginState(returnTo) {
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  loginStates.set(state, { verifier, nonce, returnTo, expiresAt: Date.now() + LOGIN_STATE_TTL });
  return { state, verifier, nonce };
}

export function consumeLoginState(state) {
  const entry = loginStates.get(state);
  loginStates.delete(state);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

export function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name || user.name || user.username,
    email: user.email || null,
    role: user.role,
    roles: user.roles || [],
    permissions: user.permissions || [],
    iam: true,
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

export async function introspectIamToken(token) {
  if (!IAM_INTROSPECT_URL) return null;
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IAM_INTROSPECT_TIMEOUT);
  try {
    const introspectionSecret = IAM_INTROSPECT_SECRET || IAM_CLIENT_SECRET;
    const introspectionAuth = introspectionSecret
      ? `Basic ${Buffer.from(`${IAM_INTROSPECT_CLIENT_ID}:${introspectionSecret}`, 'utf8').toString('base64')}`
      : null;
    const res = await fetch(IAM_INTROSPECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(introspectionAuth ? { Authorization: introspectionAuth } : {}),
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.active === false) return null;
    if (data.aud !== IAM_CLIENT_ID) return null;
    const roles = Array.isArray(data.roles) ? data.roles.map((value) => String(value).toLowerCase()) : [];
    const role = ['admin', 'editor', 'author', 'subscriber'].find((candidate) => roles.includes(candidate)) || 'subscriber';
    const permissions = Array.isArray(data.permissions) ? data.permissions.filter((value) => typeof value === 'string') : [];
    return {
      type: 'iam',
      scopes: [...new Set(['read', ...permissions])],
      user: {
        id: data.sub != null ? String(data.sub) : null,
        username: data.username || data.email || data.sub || 'iam-user',
        email: data.email || null,
        role,
        roles,
        permissions,
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

async function refreshIamSession(session) {
  if (!session?.refreshToken || !IAM_CLIENT_SECRET) return null;
  try {
    const basic = `Basic ${Buffer.from(`${IAM_INTROSPECT_CLIENT_ID}:${IAM_CLIENT_SECRET}`, 'utf8').toString('base64')}`;
    const response = await fetch(IAM_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
    });
    if (!response.ok) return null;
    const tokenSet = await response.json();
    if (!tokenSet.access_token) return null;
    sessions.set(session.sessionId, {
      ...session,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token || session.refreshToken,
      accessExpiresAt: Date.now() + Number(tokenSet.expires_in || 3600) * 1000,
    });
    return tokenSet.access_token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Resolves authentication from (in order): API key, IAM bearer token, or the
// short-lived OIDC-backed Blogs session. Blogs has no local user authority.
// Sets req.auth = { type, user?, scopes? } or null. Does not block unauthenticated requests.
export async function resolveAuth(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (bearer) {
    const key = isValidApiKey(bearer);
    if (key) return { type: 'apikey', key, scopes: key.scopes };
  } else {
    const key = isValidApiKey(req.headers['x-api-key']);
    if (key) return { type: 'apikey', key, scopes: key.scopes };
  }

  const session = sessionFromRequest(req);
  let iam = await introspectIamToken(bearer || session?.accessToken);
  if (!iam && !bearer && session) {
    const refreshedToken = await refreshIamSession(session);
    iam = await introspectIamToken(refreshedToken);
  }
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
  // Blogs owns the meaning of these permissions. IAM's sys_iam:admin role
  // must not grant administrative access to Blogs by accident.
  const permissions = new Set(req.auth?.type === 'iam' ? req.auth.user?.permissions || [] : []);
  if (permissions.has('blogs:user:manage') && permissions.has('blogs:settings:manage')) {
    return next();
  }
  return res.status(403).json({ error: 'Blogs administrator permission required' });
}

// A scope guard for API keys and IAM tokens.
export function requireScope(scope) {
  return (req, res, next) => {
    const auth = req.auth;
    if (!auth) return res.status(401).json({ error: 'Authentication required' });
    if (auth.type === 'apikey' && (auth.scopes || []).includes(scope)) return next();
    if (auth.type === 'iam') {
      const permissions = new Set(auth.user?.permissions || []);
      if (scope === 'read' && permissions.has('blogs:content:read')) return next();
      const writePermissions = [
        'blogs:post:create',
        'blogs:post:update',
        'blogs:post:delete',
        'blogs:comment:moderate',
        'blogs:media:manage',
        'blogs:settings:manage',
        'blogs:user:manage',
      ];
      if (scope === 'write' && writePermissions.some((permission) => permissions.has(permission))) return next();
    }
    return res.status(403).json({ error: `Blogs permission '${scope}' is required` });
  };
}
