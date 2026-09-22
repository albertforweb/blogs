import {
  IAM_CLIENT_ID,
  IAM_CLIENT_SECRET,
  IAM_MANIFEST_URL,
  IAM_MANIFEST_VERSION,
  IAM_REGISTRATION_TIMEOUT,
} from './config.js';
import { BLOGS_AUTHORIZATION_MANIFEST } from './authorization-manifest.js';

function basicCredentials(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function validateRegistrationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('IAM_MANIFEST_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('IAM_MANIFEST_URL must use HTTP or HTTPS');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('IAM_MANIFEST_URL must use HTTPS in production');
  }
  return url.toString();
}

export async function reconcileIamAuthorizationManifest() {
  if (!IAM_MANIFEST_URL) return { enabled: false };
  if (!IAM_CLIENT_SECRET) {
    throw new Error('IAM_CLIENT_SECRET is required when IAM_MANIFEST_URL is configured');
  }

  const manifestUrl = validateRegistrationUrl(IAM_MANIFEST_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IAM_REGISTRATION_TIMEOUT);
  const manifest = {
    ...BLOGS_AUTHORIZATION_MANIFEST,
    version: IAM_MANIFEST_VERSION,
  };

  try {
    const response = await fetch(manifestUrl, {
      method: 'PUT',
      headers: {
        Authorization: basicCredentials(IAM_CLIENT_ID, IAM_CLIENT_SECRET),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(manifest),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`IAM authorization manifest registration failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!body?.manifest?.checksum) {
      throw new Error('IAM authorization manifest response was invalid');
    }
    return { enabled: true, manifest: body.manifest };
  } finally {
    clearTimeout(timer);
  }
}
