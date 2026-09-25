import express from 'express';
import {
  IAM_AUTHORIZATION_URL,
  IAM_CALLBACK_URL,
  IAM_CLIENT_ID,
  IAM_CLIENT_SECRET,
  IAM_TOKEN_URL,
} from '../config.js';
import {
  consumeLoginState,
  createLoginState,
  introspectIamToken,
  pkceChallenge,
  publicUser,
  requireAuth,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  revokeIamToken,
} from '../auth.js';
import { Buffer } from 'node:buffer';

const router = express.Router();

function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/admin/';
  return value;
}

router.get('/login', (req, res) => {
  if (!IAM_CLIENT_SECRET) return res.status(503).send('IAM client credentials are not configured');
  const returnTo = safeReturnTo(req.query.return_to);
  const { state, verifier, nonce } = createLoginState(returnTo);
  const url = new URL(IAM_AUTHORIZATION_URL);
  url.searchParams.set('client_id', IAM_CLIENT_ID);
  url.searchParams.set('redirect_uri', IAM_CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email blogs:content:read blogs:post:create blogs:post:update blogs:post:delete blogs:comment:read blogs:comment:moderate blogs:media:manage blogs:settings:manage blogs:user:manage');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

router.get('/callback', async (req, res) => {
  const pending = consumeLoginState(req.query.state);
  if (!pending) return res.status(400).send('The sign-in request expired. Please try again.');
  if (req.query.error) return res.status(401).send(`IAM sign-in failed: ${req.query.error}`);
  if (!req.query.code) return res.status(400).send('IAM did not return an authorization code');

  const basic = `Basic ${Buffer.from(`${IAM_CLIENT_ID}:${IAM_CLIENT_SECRET}`, 'utf8').toString('base64')}`;
  try {
    const response = await fetch(IAM_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: IAM_CALLBACK_URL,
        code_verifier: pending.verifier,
      }),
    });
    if (!response.ok) return res.status(502).send('Blogs could not complete the IAM sign-in');
    const tokenSet = await response.json();
    if (!tokenSet.access_token) return res.status(502).send('IAM returned an invalid token response');
    setSessionCookie(res, tokenSet);
    return res.redirect(pending.returnTo);
  } catch {
    return res.status(502).send('Blogs could not reach IAM to complete sign-in');
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.auth.user) });
});

router.post('/logout', async (req, res) => {
  const session = clearSessionCookie(req, res);
  await revokeIamToken(session?.accessToken);
  await revokeIamToken(session?.refreshToken);
  res.status(204).end();
});

export default router;
