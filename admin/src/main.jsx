import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { render } from 'react-dom';
import './styles.css';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'posts', label: 'Posts', icon: '▤' },
  { id: 'comments', label: 'Comments', icon: '◌' },
  { id: 'media', label: 'Media', icon: '▣' },
  { id: 'taxonomies', label: 'Categories & tags', icon: '◇' },
  { id: 'themes', label: 'Themes', icon: '◈' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'keys', label: 'API keys', icon: '⌁' },
];

function api(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  return fetch(path, { credentials: 'same-origin', ...options, headers }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const error = new Error(data.error || 'Your session has expired.');
      error.auth = true;
      throw error;
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  });
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });
const formatDate = (value) => value ? new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const compactDate = (value) => value ? new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).toLocaleDateString() : '—';
const initials = (name) => String(name || '?').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';

function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [view, setView] = useState('dashboard');
  const [notice, setNotice] = useState(null);

  const notify = useCallback((message, kind = 'success') => {
    setNotice({ message, kind });
    window.setTimeout(() => setNotice(null), 3800);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const result = await api('/api/auth/me');
      setUser(result.user);
    } catch (error) {
      if (!error.auth && error.message !== 'Authentication required') setLoginError(error.message);
      setUser(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setUser(null);
    setView('dashboard');
  };

  if (checking) return <div className="boot-screen"><div className="brand-mark">B</div><span>Loading admin workspace…</span></div>;
  if (!user) return <Login initialError={loginError} />;

  return (
    <div className="app-shell">
      <Sidebar view={view} setView={setView} user={user} logout={logout} />
      <main className="app-main">
        <Topbar view={view} user={user} />
        {notice && <div className={`toast ${notice.kind}`}>{notice.message}</div>}
        <div className="page-content">
          {view === 'dashboard' && <Dashboard setView={setView} notify={notify} />}
          {view === 'posts' && <Posts notify={notify} />}
          {view === 'comments' && <Comments notify={notify} />}
          {view === 'media' && <Media notify={notify} />}
          {view === 'taxonomies' && <Taxonomies notify={notify} />}
          {view === 'themes' && <Themes notify={notify} />}
          {view === 'settings' && <Settings notify={notify} />}
          {view === 'keys' && <ApiKeys notify={notify} />}
        </div>
      </main>
    </div>
  );
}

function Login({ initialError }) {
  const error = initialError || new URLSearchParams(window.location.search).get('error');
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-lockup"><div className="brand-mark">B</div><div><strong>Blogs</strong><span>Content control plane</span></div></div>
        <p className="eyebrow">Administrator access</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage your publication, community, and site settings.</p>
        {error && <div className="form-error">{error}</div>}
        <a className="primary wide button-link" href="/blog/api/auth/login?return_to=/blog/admin/">Continue with IAM</a>
        <p className="muted">Your Blogs access and permissions are managed by IAM.</p>
      </div>
    </div>
  );
}

function Sidebar({ view, setView, user, logout }) {
  return (
    <aside className="sidebar">
      <a className="brand-lockup sidebar-brand" href="/">
        <div className="brand-mark">B</div><div><strong>Blogs</strong><span>Admin workspace</span></div>
      </a>
      <div className="nav-label">Workspace</div>
      <nav className="side-nav" aria-label="Admin navigation">
        {NAV.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'comments' && <CountBadge />}</button>)}
      </nav>
      <div className="sidebar-footer">
        <div className="identity"><div className="avatar">{initials(user.username)}</div><div><strong>{user.username}</strong><small>{user.role}</small></div></div>
        <a className="view-site" href="/" target="_blank" rel="noreferrer">View site ↗</a>
        <button className="signout" onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}

function CountBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => { api('/api/posts/counts').then((data) => setCount(data.pending_comments || 0)).catch(() => {}); }, []);
  return count ? <em className="nav-badge">{count}</em> : null;
}

function Topbar({ view, user }) {
  const item = NAV.find((entry) => entry.id === view) || NAV[0];
  return <header className="topbar"><div><p className="eyebrow">Blogs / Admin</p><h1>{item.label}</h1></div><div className="topbar-meta"><span className="status-dot" /> <span>{user.role === 'admin' ? 'Administrator' : 'Editor workspace'}</span></div></header>;
}

function SectionHeader({ eyebrow, title, description, action, children }) {
  return <div className="section-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{description && <p className="muted section-description">{description}</p>}</div><div className="section-actions">{action}{children}</div></div>;
}

function Metric({ label, value, detail, tone = 'violet' }) {
  return <div className="metric"><span className={`metric-icon ${tone}`}>◈</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function Dashboard({ setView, notify }) {
  const [counts, setCounts] = useState(null);
  const [recent, setRecent] = useState([]);
  useEffect(() => { Promise.all([api('/api/posts/counts'), api('/api/posts/recent?limit=6')]).then(([stats, posts]) => { setCounts(stats); setRecent(posts.items || []); }).catch((error) => notify(error.message, 'error')); }, [notify]);
  return <>
    <SectionHeader eyebrow="Overview" title="Your publication at a glance" description="Keep content moving, review community activity, and manage the systems behind your site." action={<a className="primary button-link" href="/" target="_blank" rel="noreferrer">View live site ↗</a>} />
    <div className="metric-grid">
      <Metric label="All posts" value={counts?.total ?? '—'} detail={`${counts?.published ?? 0} published`} tone="violet" />
      <Metric label="Drafts" value={counts?.draft ?? '—'} detail="Ready for review" tone="blue" />
      <Metric label="Comments" value={counts?.pending_comments ?? '—'} detail="Awaiting moderation" tone="amber" />
      <Metric label="Media files" value={counts?.media ?? '—'} detail={`${counts?.tags ?? 0} tags in use`} tone="teal" />
    </div>
    <div className="dashboard-grid">
      <Panel title="Recent posts" kicker="Publishing activity" action={<button className="text-button" onClick={() => setView('posts')}>View all</button>}>
        {recent.length ? <div className="activity-list">{recent.map((post) => <div className="activity-row" key={post.id}><div className="activity-icon">▤</div><div><strong>{post.title}</strong><small>{post.status} · {post.author_username || 'Unknown author'}</small></div><time>{compactDate(post.published_at || post.created_at)}</time></div>)}</div> : <Empty text="No posts yet. Create your first draft." />}
      </Panel>
      <Panel title="Quick actions" kicker="Common tasks">
        <div className="quick-grid"><button onClick={() => setView('posts')}><span>＋</span><strong>Write a post</strong><small>Create a draft or publish now</small></button><button onClick={() => setView('comments')}><span>◌</span><strong>Moderate comments</strong><small>Keep the conversation healthy</small></button><button onClick={() => setView('media')}><span>▣</span><strong>Upload media</strong><small>Add images and files</small></button><button onClick={() => setView('settings')}><span>⚙</span><strong>Site settings</strong><small>Update your publication</small></button></div>
      </Panel>
    </div>
  </>;
}

function Panel({ title, kicker, action, children, className = '' }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><p className="eyebrow">{kicker}</p><h3>{title}</h3></div>{action}</div>{children}</section>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }
function Loading() { return <div className="loading">Loading…</div>; }
function ErrorState({ message }) { return <div className="error-state">{message}</div>; }
function StatusPill({ value }) { return <span className={`pill ${String(value || '').toLowerCase()}`}>{value}</span>; }

function Posts({ notify }) {
  const [posts, setPosts] = useState([]); const [categories, setCategories] = useState([]); const [filter, setFilter] = useState('any'); const [query, setQuery] = useState(''); const [editing, setEditing] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); try { const [postData, catData] = await Promise.all([api(`/api/posts?limit=100&status=${filter}`), api('/api/categories')]); setPosts(postData.items || []); setCategories(catData.items || []); setError(''); } catch (err) { setError(err.message); } finally { setLoading(false); } }, [filter]);
  useEffect(() => { load(); }, [load]);
  const visible = posts.filter((post) => !query || `${post.title} ${post.slug}`.toLowerCase().includes(query.toLowerCase()));
  const remove = async (id) => { if (!window.confirm('Delete this post permanently?')) return; try { await api(`/api/posts/${id}`, { method: 'DELETE' }); notify('Post deleted'); load(); } catch (err) { notify(err.message, 'error'); } };
  return <>
    <SectionHeader eyebrow="Content" title="Posts" description="Write, organize, and publish everything your readers see." action={<button className="primary" onClick={() => setEditing({ title: '', slug: '', excerpt: '', content: '', status: 'draft', category_id: '', tags: '', featured_image: '' })}>＋ New post</button>} />
    <div className="toolbar"><label className="search">⌕<input placeholder="Search posts" value={query} onChange={(e) => setQuery(e.target.value)} /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="any">All statuses</option><option value="published">Published</option><option value="draft">Drafts</option><option value="trash">Trash</option></select><button className="secondary" onClick={load}>Refresh</button></div>
    <Panel title="Content library" kicker={`${visible.length} posts`}>
      {loading ? <Loading /> : error ? <ErrorState message={error} /> : visible.length ? <div className="table-scroll"><table><thead><tr><th>Post</th><th>Status</th><th>Author</th><th>Updated</th><th /></tr></thead><tbody>{visible.map((post) => <tr key={post.id}><td><strong>{post.title || 'Untitled'}</strong><small>/{post.slug}</small></td><td><StatusPill value={post.status} /></td><td>{post.author?.username || '—'}</td><td>{formatDate(post.updated_at)}</td><td className="actions"><button className="table-button" onClick={() => setEditing({ ...post, category_id: post.category_id || '', tags: (post.tags || []).map((tag) => tag.name).join(', ') })}>Edit</button><button className="table-button danger" onClick={() => remove(post.id)}>Delete</button></td></tr>)}</tbody></table></div> : <Empty text="No posts match your filters." />}
    </Panel>
    {editing && <PostEditor post={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Post saved'); load(); }} />}
  </>;
}

function PostEditor({ post, categories, onClose, onSaved }) {
  const [form, setForm] = useState(post); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async (event) => { event.preventDefault(); setBusy(true); setError(''); const payload = { ...form, category_id: form.category_id || null, tags: String(form.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean) }; try { if (form.id) await api(`/api/posts/${form.id}`, json('PUT', payload)); else await api('/api/posts', json('POST', payload)); onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  return <Modal title={post.id ? 'Edit post' : 'New post'} onClose={onClose} wide><form onSubmit={save} className="editor-form"><div className="editor-main"><label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label>Slug<input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="generated-from-title" /></label><label>Excerpt<textarea rows="3" value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} /></label><label>Content <span className="hint">Markdown supported</span><textarea className="content-editor" rows="16" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label></div><aside className="editor-side"><label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="trash">Trash</option></select></label><label>Category<select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">Uncategorized</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Tags <span className="hint">Comma separated</span><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label><label>Featured image URL<input value={form.featured_image || ''} onChange={(e) => setForm({ ...form, featured_image: e.target.value })} /></label></aside><div className="modal-footer">{error && <div className="form-error">{error}</div>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save post'}</button></div></form></Modal>;
}

function Comments({ notify }) {
  const [comments, setComments] = useState([]); const [status, setStatus] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const data = await api(`/api/comments${status ? `?status=${status}` : ''}`); setComments(data.items || []); } catch (err) { notify(err.message, 'error'); } finally { setLoading(false); } }, [status, notify]);
  useEffect(() => { load(); }, [load]);
  const update = async (id, nextStatus) => { try { await api(`/api/comments/${id}`, json('PATCH', { status: nextStatus })); notify(`Comment marked ${nextStatus}`); load(); } catch (err) { notify(err.message, 'error'); } };
  const remove = async (id) => { if (!window.confirm('Delete this comment?')) return; try { await api(`/api/comments/${id}`, { method: 'DELETE' }); notify('Comment deleted'); load(); } catch (err) { notify(err.message, 'error'); } };
  return <><SectionHeader eyebrow="Community" title="Comments" description="Review reader feedback and keep moderation decisions transparent." /><div className="toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All comments</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="spam">Spam</option><option value="trash">Trash</option></select><button className="secondary" onClick={load}>Refresh</button></div><Panel title="Moderation queue" kicker={`${comments.length} comments`}>{loading ? <Loading /> : comments.length ? <div className="comment-list">{comments.map((comment) => <article className="comment" key={comment.id}><div className="comment-head"><div><strong>{comment.author}</strong><small>{comment.email || 'No email'} · {formatDate(comment.created_at)}</small></div><StatusPill value={comment.status} /></div><p>{comment.content}</p><div className="comment-foot"><a href={`/post/${comment.post_slug}`} target="_blank" rel="noreferrer">View post ↗</a><div>{comment.status !== 'approved' && <button className="table-button" onClick={() => update(comment.id, 'approved')}>Approve</button>}{comment.status !== 'spam' && <button className="table-button" onClick={() => update(comment.id, 'spam')}>Spam</button>}<button className="table-button danger" onClick={() => remove(comment.id)}>Delete</button></div></div></article>)}</div> : <Empty text="No comments in this queue." />}</Panel></>;
}

function Media({ notify }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const data = await api('/api/media?limit=100'); setItems(data.items || []); } catch (err) { notify(err.message, 'error'); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  const upload = async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); const body = new FormData(); body.append('file', file); try { await api('/api/media', { method: 'POST', body }); notify('Media uploaded'); load(); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); event.target.value = ''; } };
  const remove = async (id) => { if (!window.confirm('Delete this media file?')) return; try { await api(`/api/media/${id}`, { method: 'DELETE' }); notify('Media deleted'); load(); } catch (err) { notify(err.message, 'error'); } };
  return <><SectionHeader eyebrow="Library" title="Media" description="Upload and reuse images, documents, and other assets." action={<label className={`primary upload-button ${busy ? 'disabled' : ''}`}>＋ Upload file<input type="file" onChange={upload} disabled={busy} hidden /></label>} /><Panel title="Media library" kicker={`${items.length} files`}>{loading ? <Loading /> : items.length ? <div className="media-grid">{items.map((item) => <article className="media-card" key={item.id}>{item.mime_type?.startsWith('image/') ? <img src={item.url} alt={item.original_name} /> : <div className="file-preview">{item.mime_type?.split('/')[0]?.toUpperCase() || 'FILE'}</div>}<div className="media-info"><strong title={item.original_name}>{item.original_name}</strong><small>{Math.round((item.size || 0) / 1024)} KB · {compactDate(item.created_at)}</small><div><button className="table-button" onClick={() => navigator.clipboard?.writeText(item.url).then(() => notify('URL copied')).catch(() => notify(item.url))}>Copy URL</button><button className="table-button danger" onClick={() => remove(item.id)}>Delete</button></div></div></article>)}</div> : <Empty text="Your media library is empty." />}</Panel></>;
}

function Taxonomies({ notify }) {
  const [tab, setTab] = useState('categories'); const [items, setItems] = useState([]); const [editing, setEditing] = useState(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const data = await api(`/api/${tab}`); setItems(data.items || []); } catch (err) { notify(err.message, 'error'); } finally { setLoading(false); } }, [tab, notify]);
  useEffect(() => { load(); }, [load]);
  const remove = async (id) => { if (!window.confirm(`Delete this ${tab.slice(0, -1)}?`)) return; try { await api(`/api/${tab}/${id}`, { method: 'DELETE' }); notify('Deleted'); load(); } catch (err) { notify(err.message, 'error'); } };
  const save = async (event) => { event.preventDefault(); try { if (editing.id) await api(`/api/${tab}/${editing.id}`, json('PUT', editing)); else await api(`/api/${tab}`, json('POST', editing)); notify('Saved'); setEditing(null); load(); } catch (err) { notify(err.message, 'error'); } };
  return <><SectionHeader eyebrow="Organization" title="Categories & tags" description="Give readers clear ways to explore your content." action={<button className="primary" onClick={() => setEditing(tab === 'categories' ? { name: '', slug: '', description: '', parent_id: '' } : { name: '' })}>＋ New {tab === 'categories' ? 'category' : 'tag'}</button>} /><div className="tabs"><button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Categories</button><button className={tab === 'tags' ? 'active' : ''} onClick={() => setTab('tags')}>Tags</button></div><Panel title={tab === 'categories' ? 'Categories' : 'Tags'} kicker={`${items.length} records`}>{loading ? <Loading /> : items.length ? <div className="table-scroll"><table><thead><tr><th>Name</th><th>Slug</th><th>Published posts</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</td><td><code>{item.slug}</code></td><td>{item.post_count || 0}</td><td className="actions"><button className="table-button" onClick={() => setEditing({ ...item })}>Edit</button><button className="table-button danger" onClick={() => remove(item.id)}>Delete</button></td></tr>)}</tbody></table></div> : <Empty text={`No ${tab} yet.`} />}</Panel>{editing && <Modal title={`${editing.id ? 'Edit' : 'New'} ${tab === 'categories' ? 'category' : 'tag'}`} onClose={() => setEditing(null)}><form className="stack-form" onSubmit={save}><label>Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></label>{tab === 'categories' && <><label>Slug<input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></label><label>Description<textarea rows="4" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label></>}<div className="modal-footer"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary">Save</button></div></form></Modal>}</>;
}

function Themes({ notify }) {
  const [themes, setThemes] = useState([]); const [selected, setSelected] = useState(null); const [files, setFiles] = useState([]); const [file, setFile] = useState(null); const [content, setContent] = useState(''); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const data = await api('/api/themes'); setThemes(data.items || []); } catch (err) { notify(err.message, 'error'); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  const choose = async (theme) => { setSelected(theme); setFile(null); setContent(''); try { const data = await api(`/api/themes/${encodeURIComponent(theme.name)}/files`); setFiles(data.items || []); } catch (err) { notify(err.message, 'error'); } };
  const openFile = async (path) => { setFile(path); try { const data = await api(`/api/themes/${encodeURIComponent(selected.name)}/file/${path}`); setContent(data.content || ''); } catch (err) { notify(err.message, 'error'); } };
  const saveFile = async () => { setSaving(true); try { await api(`/api/themes/${encodeURIComponent(selected.name)}/file/${file}`, json('PUT', { content })); notify('Theme file saved'); } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); } };
  const activate = async (theme) => { try { await api(`/api/themes/${encodeURIComponent(theme.name)}/activate`, { method: 'POST' }); notify(`${theme.title} is now active`); load(); } catch (err) { notify(err.message, 'error'); } };
  return <><SectionHeader eyebrow="Appearance" title="Themes" description="Choose the presentation layer and fine-tune its templates." /><div className="theme-layout"><div className="theme-list">{loading ? <Loading /> : themes.map((theme) => <button className={`theme-card ${selected?.name === theme.name ? 'selected' : ''}`} key={theme.name} onClick={() => choose(theme)}><div className="theme-art">{theme.title.slice(0, 1)}</div><div><strong>{theme.title}</strong><small>{theme.description || 'No description'}</small><small>v{theme.version} · {theme.author || 'Unknown author'}</small></div>{theme.active && <span className="active-label">Active</span>}</button>)}</div>{selected ? <Panel title={`${selected.title} files`} kicker="Theme editor" className="theme-editor"><div className="file-tabs">{files.map((item) => <button className={file === item.path ? 'active' : ''} key={item.path} onClick={() => openFile(item.path)}>{item.path}</button>)}</div>{file ? <><textarea className="code-editor" value={content} onChange={(e) => setContent(e.target.value)} spellCheck="false" /><div className="modal-footer"><button className="secondary" onClick={() => activate(selected)} disabled={selected.active}>{selected.active ? 'Active theme' : 'Activate theme'}</button><button className="primary" onClick={saveFile} disabled={saving}>{saving ? 'Saving…' : 'Save file'}</button></div></> : <Empty text="Choose a theme file to edit." />}</Panel> : <Panel title="Theme library" kicker="Select a theme"><Empty text="Select a theme to inspect its files." /></Panel>}</div></>;
}

function Settings({ notify }) {
  const [form, setForm] = useState(null); const [saving, setSaving] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { api('/api/settings').then(setForm).catch((err) => notify(err.message, 'error')).finally(() => setLoading(false)); }, [notify]);
  if (loading || !form) return <><SectionHeader eyebrow="Configuration" title="Settings" description="Shape the public experience and content workflow." /><Panel title="Site settings" kicker="Loading"><Loading /></Panel></>;
  const update = (key, value) => setForm({ ...form, [key]: value });
  const save = async (event) => { event.preventDefault(); setSaving(true); try { await api('/api/settings', json('PUT', form)); notify('Settings saved'); } catch (err) { notify(err.message, 'error'); } finally { setSaving(false); } };
  return <><SectionHeader eyebrow="Configuration" title="Settings" description="Shape the public experience and content workflow." /><form onSubmit={save} className="settings-grid"><Panel title="Site identity" kicker="Public presentation"><label>Site title<input value={form.site_title || ''} onChange={(e) => update('site_title', e.target.value)} /></label><label>Tagline<input value={form.tagline || ''} onChange={(e) => update('tagline', e.target.value)} /></label><label>Description<textarea rows="4" value={form.description || ''} onChange={(e) => update('description', e.target.value)} /></label><label>Site path <span className="hint">For reverse proxies, e.g. /blog</span><input value={form.site_path || ''} onChange={(e) => update('site_path', e.target.value)} placeholder="/" /></label></Panel><Panel title="Publishing" kicker="Content defaults"><label>Posts per page<input type="number" min="1" max="100" value={form.posts_per_page || 10} onChange={(e) => update('posts_per_page', e.target.value)} /></label><label>Permalink structure<select value={form.permalink || '/post/:slug'} onChange={(e) => update('permalink', e.target.value)}><option value="/post/:slug">/post/:slug</option><option value="/:slug">/:slug</option></select></label><label className="check-label"><input type="checkbox" checked={form.comments_open === '1'} onChange={(e) => update('comments_open', e.target.checked ? '1' : '0')} /> Allow comments</label><label className="check-label"><input type="checkbox" checked={form.require_comment_moderation === '1'} onChange={(e) => update('require_comment_moderation', e.target.checked ? '1' : '0')} /> Moderate new comments</label><label>Google Analytics ID<input value={form.ga_id || ''} onChange={(e) => update('ga_id', e.target.value)} placeholder="G-XXXXXXXXXX" /></label></Panel><Panel title="Custom head" kicker="Advanced"><label>Custom metadata<textarea rows="6" value={form.custom_meta || ''} onChange={(e) => update('custom_meta', e.target.value)} /></label><label>Custom head HTML<textarea rows="6" value={form.custom_head_html || ''} onChange={(e) => update('custom_head_html', e.target.value)} /></label></Panel><div className="settings-actions"><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></div></form></>;
}

function ApiKeys({ notify }) {
  const [items, setItems] = useState([]); const [name, setName] = useState(''); const [scopes, setScopes] = useState(['read']); const [newKey, setNewKey] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const data = await api('/api/keys'); setItems(data.items || []); } catch (err) { notify(err.message, 'error'); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { load(); }, [load]);
  const create = async (event) => { event.preventDefault(); try { const data = await api('/api/keys', json('POST', { name, scopes })); setNewKey(data.key); setName(''); notify('API key created'); load(); } catch (err) { notify(err.message, 'error'); } };
  const update = async (item, changes) => { try { await api(`/api/keys/${item.id}`, json('PUT', changes)); notify('API key updated'); load(); } catch (err) { notify(err.message, 'error'); } };
  const remove = async (id) => { if (!window.confirm('Delete this API key?')) return; try { await api(`/api/keys/${id}`, { method: 'DELETE' }); notify('API key deleted'); load(); } catch (err) { notify(err.message, 'error'); } };
  return <><SectionHeader eyebrow="Integrations" title="API keys" description="Give external sites controlled access to the Blogs API." /><Panel title="Create an API key" kicker="Credentials"><form className="inline-form" onSubmit={create}><label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="mainsite-content" required /></label><label>Scopes<div className="check-row"><label><input type="checkbox" checked={scopes.includes('read')} onChange={(e) => setScopes(e.target.checked ? [...new Set([...scopes, 'read'])] : scopes.filter((scope) => scope !== 'read'))} /> Read</label><label><input type="checkbox" checked={scopes.includes('write')} onChange={(e) => setScopes(e.target.checked ? [...new Set([...scopes, 'write'])] : scopes.filter((scope) => scope !== 'write'))} /> Write</label></div></label><button className="primary">Create key</button></form></Panel>{newKey && <div className="secret-card"><p className="eyebrow">Copy this secret now</p><strong>{newKey}</strong><small>This value will not be shown again.</small><button className="secondary" onClick={() => navigator.clipboard?.writeText(newKey).then(() => notify('API key copied'))}>Copy secret</button></div>}<Panel title="Issued keys" kicker={`${items.length} keys`}>{loading ? <Loading /> : items.length ? <div className="table-scroll"><table><thead><tr><th>Name</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>by {item.created_by_username || 'system'}</small></td><td>{item.scopes}</td><td>{compactDate(item.created_at)}</td><td>{compactDate(item.last_used_at)}</td><td><StatusPill value={item.revoked ? 'revoked' : 'active'} /></td><td className="actions">{!item.revoked && <button className="table-button" onClick={() => update(item, { revoked: true })}>Revoke</button>}<button className="table-button danger" onClick={() => remove(item.id)}>Delete</button></td></tr>)}</tbody></table></div> : <Empty text="No API keys have been issued." />}</Panel></>;
}

function Modal({ title, onClose, children, wide = false }) { return <div className="modal-backdrop" role="presentation"><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><p className="eyebrow">Blogs admin</p><h2>{title}</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></div>{children}</div></div>; }

render(<App />, document.getElementById('root'));
