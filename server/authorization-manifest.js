// Blogs owns the meaning of these permissions and roles. IAM stores the
// application-scoped definitions and assignments, but does not make these
// names globally meaningful.
export const BLOGS_AUTHORIZATION_MANIFEST = Object.freeze({
  version: '1.0.0',
  permissions: Object.freeze([
    { name: 'blogs:content:read', description: 'Read blog content' },
    { name: 'blogs:post:create', description: 'Create blog posts' },
    { name: 'blogs:post:update', description: 'Update blog posts' },
    { name: 'blogs:post:delete', description: 'Delete blog posts' },
    { name: 'blogs:comment:read', description: 'Read comments and moderation queues' },
    { name: 'blogs:comment:moderate', description: 'Approve, reject, or delete comments' },
    { name: 'blogs:media:manage', description: 'Upload and manage media' },
    { name: 'blogs:settings:manage', description: 'Manage blog settings and themes' },
    { name: 'blogs:user:manage', description: 'Manage local blog users' },
  ]),
  roles: Object.freeze([
    {
      name: 'subscriber',
      description: 'Read-only blog user',
      permissions: Object.freeze(['blogs:content:read']),
    },
    {
      name: 'author',
      description: 'Can create and update blog posts',
      permissions: Object.freeze(['blogs:content:read', 'blogs:post:create', 'blogs:post:update']),
    },
    {
      name: 'editor',
      description: 'Can manage content and moderate comments',
      permissions: Object.freeze([
        'blogs:content:read',
        'blogs:post:create',
        'blogs:post:update',
        'blogs:post:delete',
        'blogs:comment:read',
        'blogs:comment:moderate',
        'blogs:media:manage',
      ]),
    },
    {
      name: 'admin',
      description: 'Full blogs administration',
      permissions: Object.freeze([
        'blogs:content:read',
        'blogs:post:create',
        'blogs:post:update',
        'blogs:post:delete',
        'blogs:comment:read',
        'blogs:comment:moderate',
        'blogs:media:manage',
        'blogs:settings:manage',
        'blogs:user:manage',
      ]),
    },
  ]),
});
