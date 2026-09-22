import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import { THEMES_DIR } from './config.js';
import { db } from './db.js';
import { mdToHtml, htmlToPlainText } from './md.js';

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function getSitePath() {
  const raw = getSetting('site_path') || '';
  return raw ? `/${raw.replace(/^\/+|\/+$/g, '')}` : '';
}

export function absUrl(path = '/') {
  const sp = getSitePath();
  const p = path.startsWith('/') ? path : `/${path}`;
  const joined = `${sp}${p}`.replace(/\/{2,}/g, '/');
  return joined || '/';
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getActiveTheme() {
  return getSetting('active_theme') || 'default';
}

export function listThemes() {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs.readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(THEMES_DIR, d.name, 'theme.json');
      let meta = {};
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
      }
      return {
        name: d.name,
        title: meta.name || d.name,
        description: meta.description || '',
        author: meta.author || '',
        version: meta.version || '1.0.0',
        active: d.name === getActiveTheme(),
      };
    });
}

export function themeDir(name) {
  const root = path.resolve(THEMES_DIR);
  const dir = path.resolve(root, name);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error('Invalid theme name');
  }
  return dir;
}

export function themeFilePath(theme, relPath) {
  const dir = themeDir(theme);
  const resolved = path.resolve(dir, relPath);
  if (!resolved.startsWith(dir + path.sep) && resolved !== dir) {
    throw new Error('Invalid theme file path');
  }
  return resolved;
}

const STATIC_EXTENSIONS = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf'];

export function listThemeFiles(theme) {
  const dir = themeDir(theme);
  const out = [];
  (function walk(current, prefix) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else {
        const type = STATIC_EXTENSIONS.some((e) => entry.name.toLowerCase().endsWith(e))
          || entry.name.toLowerCase() === 'theme.json' ? 'asset' : 'template';
        out.push({ path: rel, type });
      }
    }
  })(dir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Handlebars setup
// ---------------------------------------------------------------------------

const templateCache = new Map();

function cacheKey(theme, file) {
  const filePath = themeFilePath(theme, file);
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
  return `${theme}|${file}|${stat}`;
}

export function invalidateThemeCache() {
  templateCache.clear();
}

function loadTemplate(theme, file) {
  const key = cacheKey(theme, file);
  if (templateCache.has(key)) return templateCache.get(key);
  const filePath = themeFilePath(theme, file);
  if (!fs.existsSync(filePath)) return null;
  const source = fs.readFileSync(filePath, 'utf8');
  const template = Handlebars.compile(source, { noEscape: false });
  templateCache.set(key, template);
  return template;
}

function registerPartials(theme) {
  const partialsDir = themeFilePath(theme, 'partials');
  if (!fs.existsSync(partialsDir)) return;
  for (const entry of fs.readdirSync(partialsDir)) {
    const file = path.join(partialsDir, entry);
    if (!fs.statSync(file).isFile() || !entry.toLowerCase().endsWith('.hbs')) continue;
    const stat = fs.statSync(file).mtimeMs;
    const name = entry.replace(/\.hbs$/i, '');
    const key = `partial:${theme}:${name}:${stat}`;
    if (!Handlebars.partials['__cached_' + key]) {
      Handlebars.registerPartial(name, fs.readFileSync(file, 'utf8'));
      Handlebars.partials['__cached_' + key] = true;
    }
  }
}

function registerHelpers() {
  if (Handlebars.helpers.__registered) return;

  Handlebars.registerHelper('formatDate', (date, options) => {
    if (!date) return '';
    const d = new Date(String(date).replace(' ', 'T') + (String(date).includes('Z') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return String(date);
    const fmt = options?.hash?.format || 'MMMM D, YYYY';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const map = {
      YYYY: d.getUTCFullYear(),
      YYY: String(d.getUTCFullYear()).slice(-3),
      YY: String(d.getUTCFullYear()).slice(-2),
      MMMM: months[d.getUTCMonth()],
      MMM: months[d.getUTCMonth()].slice(0, 3),
      MM: String(d.getUTCMonth() + 1).padStart(2, '0'),
      M: d.getUTCMonth() + 1,
      DD: String(d.getUTCDate()).padStart(2, '0'),
      D: d.getUTCDate(),
      HH: String(d.getUTCHours()).padStart(2, '0'),
      hh: String((d.getUTCHours() % 12) || 12).padStart(2, '0'),
      mm: String(d.getUTCMinutes()).padStart(2, '0'),
      A: d.getUTCHours() >= 12 ? 'PM' : 'AM',
    };
    return fmt.replace(/YYYY|YYY|YY|MMMM|MMM|MM|M|DD|D|HH|hh|mm|A/g, (m) => map[m]);
  });

  Handlebars.registerHelper('ifeq', (a, b, options) => (a === b ? options.fn(this) : options.inverse(this)));

  Handlebars.registerHelper('stripHtml', (text, options) => {
    const plain = htmlToPlainText(text);
    const max = Number(options?.hash?.max || 200);
    return plain.length > max ? plain.slice(0, max).trimEnd() + '…' : plain;
  });

  Handlebars.registerHelper('markdown', (text) => new Handlebars.SafeString(mdToHtml(text)));

  Handlebars.registerHelper('truncate', (text, options) => {
    const max = Number(options?.hash?.max || 100);
    const s = String(text || '');
    return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
  });

  Handlebars.registerHelper('media', (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const p = url.startsWith('/') ? url : `/uploads/${url}`;
    const sp = getSitePath();
    return sp && p.startsWith(sp) ? p : absUrl(p);
  });

  Handlebars.registerHelper('themeAsset', (file) => absUrl(`/theme-assets/${file}`));

  Handlebars.registerHelper('baseUrl', () => getSitePath());

  Handlebars.registerHelper('pagination', (ctx) => {
    if (!ctx || ctx.pages <= 1) return '';
    const base = absUrl(ctx.baseUrl || '/');
    const { page = 1, pages = 1 } = ctx;
    let html = '<nav class="pagination">';
    html += page > 1
      ? `<a class="page-item prev" href="${base}${page - 1 === 1 ? '' : '?page=' + (page - 1)}">← Newer</a>`
      : '<span class="page-item prev disabled">← Newer</span>';
    html += `<span class="page-info">Page ${page} of ${pages}</span>`;
    html += page < pages
      ? `<a class="page-item next" href="${base}?page=${page + 1}">Older →</a>`
      : '<span class="page-item next disabled">Older →</span>';
    html += '</nav>';
    return new Handlebars.SafeString(html);
  });

  Handlebars.registerHelper('json', (value) => JSON.stringify(value));
  Handlebars.helpers.__registered = true;
}

registerHelpers();
registerPartials(getActiveTheme());

export function renderTheme(templateName, extraContext = {}) {
  const activeTheme = getActiveTheme();
  registerPartials(activeTheme);
  const template = loadTemplate(activeTheme, `${templateName}.hbs`);
  if (!template) {
    throw new Error(`Template "${templateName}.hbs" not found in theme "${activeTheme}"`);
  }

  const settings = getSettings();
  const context = {
    ...extraContext,
    settings,
    siteTitle: settings.site_title || 'My Blog',
    siteTagline: settings.tagline || '',
    siteDescription: settings.description || '',
    theme: activeTheme,
    baseUrl: getSitePath(),
    categories: db.prepare('SELECT id, name, slug FROM categories ORDER BY name').all(),
  };
  if (context.post) {
    context.post.contentHtml = mdToHtml(context.post.content);
    context.post.excerptText = htmlToPlainText(context.post.excerpt || context.post.content);
  }
  return template(context);
}

export function renderPage(res, templateName, extraContext = {}, status = 200) {
  try {
    const html = renderTheme(templateName, extraContext);
    res.status(status).type('html').send(html);
  } catch (err) {
    res.status(status).type('html').send(`<h1>Template error</h1><pre>${String(err.message)}</pre>`);
  }
}