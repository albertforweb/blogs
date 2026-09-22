# Blogs CMS

A self-hosted blogging content management system inspired by WordPress, built with **Node.js, Express, Handlebars, SQLite and React**.

- No PHP. No external database server. No build step required for the server itself.
- Admin panel is a React SPA for managing content, themes, users, media and settings.
- The public site is server-rendered from Handlebars theme templates (fast, SEO-friendly).

## Features

| Area | Capabilities |
| --- | --- |
| Posts | Draft / publish / trash, slugs, Markdown content, excerpts, featured images, scheduled publishing |
| Taxonomies | Categories and tags with slug-based archive pages |
| Media library | Image & file uploads (Multer), featured-image picker, copy URL |
| Comments | Public commenting with honeypot spam filter, moderation queue (approve / spam / trash) |
| Users & roles | Admin, Editor, Author roles |
| Theme system | Multiple themes with `theme.json` metadata, template + CSS editing from the admin panel |
| SEO | Custom permalinks (`/post/:slug` or `/:slug`), RSS feed, XML sitemap, meta descriptions, Open Graph |
| Settings | Site title, tagline, posts-per-page, comments policy, Google Analytics, custom `<head>` meta |
| Search | Full-title/content search on the public site |

## Requirements

- Node.js **>= 22.5** (uses the built-in `node:sqlite` module — no native compilation)

## Quick start

```bash
# 1. install server + admin dependencies
npm install

# 2. build the admin panel (React)
npm run build

# 3. create your first admin user (follow the prompts)
npm run create-admin

# 4. start the server
npm run start
```

Open:

- **Admin panel:** http://localhost:4000/admin/
- **Your blog:** http://localhost:4000/

## Development

Run the API server and the Vite dev server (with hot reload) together:

```bash
npm run dev
```

- Public site + API:  http://localhost:4000
- Admin dev server:  http://localhost:5173/admin/  (proxies `/api`, `/uploads` to :4000)

## How things work

### Layout

```
blogs/
├── server/            Express app, REST API, theme renderer, SQLite schema
├── admin/             React + Vite admin panel (built to admin/dist)
├── themes/            Blog templates. One folder per theme.
│   └── default/       Default theme (Handlebars templates + assets/style.css)
├── scripts/           create-admin.js CLI
├── data/              SQLite database (created automatically, git-ignored)
└── uploads/           Uploaded media files (git-ignored)
```

### Creating content

The admin panel covers the full workflow: write a post in Markdown, preview it, pick a category,
attach tags, choose a featured image from the media library, save a draft or publish.

Slugs are auto-generated from titles and kept unique (`hello-world`, `hello-world-2`, …).

### Themes

Themes live in `themes/<name>/`. Each theme needs a `theme.json`:

```json
{
  "name": "My Theme",
  "description": "What it looks like",
  "author": "you",
  "version": "1.0.0"
}
```

Templates are [Handlebars](https://handlebarsjs.com/) files. The renderer looks up `home.hbs`,
`post.hbs`, `category.hbs`, `tag.hbs`, `search.hbs` and `notfound.hbs` (each may include
`partials/header.hbs` and `partials/footer.hbs`). Asset files in `assets/` are served at
`/theme-assets/...` and `assets/style.css` is also served at `/theme.css`.

Everything in `themes/` can also be edited straight from **Themes → Edit files** in the admin panel;
saving a file re-renders the public site immediately (no restart).

Available template helpers: `siteTitle`, `siteTagline`, `siteDescription`, `siteUrl`,
`formatDate`, `stripHtml`, `markdown`, `media`, `pagination`, `themeAsset`, `ifeq`, `truncate`, `baseUrl`.

### Permalinks

Two structures are supported and can be switched in **Settings**:

- `/post/:slug` (default)
- `/:slug`

### Site path (`site_path`) and reverse-proxying

By default the blog is served at the domain root. If you want to run it behind a reverse proxy at a
path such as `/blog` (e.g. to share a domain with another site), set **Settings → Site path** to
`/blog` (or `SITE_PATH` when it lands as a setting default).

Every generated URL gets the prefix automatically: public pages, post/category/tag/search links,
RSS and sitemap, `theme.css`, `theme-assets`, `/uploads` media, and the admin panel
(injected `<base>` tag + `window.__BLOGS__.basePath`). The server also accepts incoming requests
with or without the prefix, so `localhost:4000/blog/post/hello-world` and
`localhost:4000/post/hello-world` both work.

Example nginx config that forwards `/blog/*` to the blog server:

```nginx
location /blog/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Set `site_path` back to empty to serve at the root again.

### API overview

Public (no auth) — read API for any other site/UI to build on:

```
GET    /api/public/info          site title, permalink, etc.
GET    /api/public/posts         published posts (page, per_page, category, tag, q)
GET    /api/public/posts/:slug   single published post + approved comments
GET    /api/public/categories    categories with post counts
GET    /api/public/tags          tags with post counts
POST   /api/public/comments      post a comment (honeypot protected)
```

Authenticated (with `Authorization: Bearer <jwt-or-api-key>` for admin routes, see below):

```
POST   /api/auth/login           returns JWT + user (local account login)
GET    /api/auth/me              PUT /api/auth/password   (local accounts only)
GET    /api/posts                list + filters           POST/PUT/DELETE /api/posts/...
GET    /api/posts/counts         GET /api/posts/recent    POST /api/posts/preview
GET    /api/categories           POST/PUT/DELETE
GET    /api/tags                 POST/PUT/DELETE
GET    /api/media                POST (upload) / DELETE
GET    /api/comments             PATCH/DELETE
GET    /api/settings             PUT           (admin)
GET    /api/users                POST/PUT/DELETE (admin)
GET    /api/themes               POST /activate, GET/PUT file contents (admin)
GET    /api/keys                 POST/PUT/DELETE  (admin — API key management)
```

Public URLs: `/`, `/post/:slug`, `/category/:slug`, `/tag/:slug`, `/search?q=`, `/rss.xml`, `/sitemap.xml`.
When a `site_path` is configured these are served under that prefix (see below).

### Consuming from another site / app

Blogs is fully self-contained (own accounts, own admin), but its JSON API is also designed for
other sites to build their own UI/pages/style on top of it:

- **Published content is open** — `/api/public/*` needs no token at all.
- **API keys for everything else** — create one in **Admin → API keys**. Send it as
  `Authorization: Bearer blogs_...` (or `X-API-Key: blogs_...`). Scopes gate permissions:
  `read` allows listing/reading posts (incl. drafts, counts, media), `write` adds
  create/edit/delete for posts, media and moderation. Keys are revocable; the raw key is shown
  only once at creation.
- **CORS** — the API and `/uploads` send CORS headers. Set `ALLOWED_ORIGINS` (comma-separated,
  default `*`) to lock down browser access to specific origins. Server-to-server callers are
  unaffected by CORS.

```bash
# list published posts JSON
curl http://localhost:4000/api/public/posts?per_page=5

# create a post using an API key
curl -X POST http://localhost:4000/api/posts \
  -H "Authorization: Bearer blogs_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello from mainsite","status":"draft","content":"**hi**"}'
```

### Optional IAM / SSO token integration

If your other apps already hold tokens issued by an IAM/SSO service, blogs can accept them instead
of its own JWT/API key. This is opt-in and off by default so blogs stays independent:

| Env var | Default | Purpose |
| --- | --- | --- |
| `IAM_INTROSPECT_URL` | *(empty = disabled)* | IAM endpoint that accepts `{ token }` and returns `{ active, sub, username, email, role? }` |
| `IAM_INTROSPECT_HEADER` | `x-iam-token` | Request header your app uses to forward the IAM token/cookie value |
| `IAM_INTROSPECT_SECRET` | *(empty)* | Sent to IAM as `Authorization: Bearer <secret>` |
| `IAM_INTROSPECT_TIMEOUT` | `5000` | ms before the introspection call aborts |

Example nginx/mod_proxy config is not required for this — the external app just adds the header:

```bash
curl http://localhost:4000/api/posts \
  -H "X-IAM-Token: <token-issued-by-iam>" \
  -H "Accept: application/json"
```

The token is exchanged with IAM on every request, so blogs availability then depends on IAM being
reachable — that's why the default (local JWT / API keys) is recommended for independent apps.
Roles from IAM map directly (`admin/editor/author/subscriber`); IAM-authenticated requests are
read-only unless the mapped role is an author-equivalent and a `write`-gated endpoint is called.

### Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port (change it if 4000 is taken, e.g. `PORT=5000 npm start`) |
| `DATA_DIR` | `./data` | SQLite database + secret location |
| `UPLOADS_DIR` | `./uploads` | Uploaded files |
| `JWT_SECRET` | random, stored in `data/.secret` | Signing key for auth tokens |
| `ALLOWED_ORIGINS` | `*` | Comma-separated origins allowed by CORS on `/api` + `/uploads` |

## Notes

- Content is stored as Markdown and rendered through `marked` + `sanitize-html` on the server, so
  the public site never outputs raw unsanitised content.
- Comment submission includes a hidden honeypot field to keep most spam bots out; new comments go
  to the moderation queue by default (configurable in Settings).
- Passwords are hashed with bcrypt; login tokens expire after 7 days.