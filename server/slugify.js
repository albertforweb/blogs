export function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function uniqueSlug(baseSlug, existingCheck) {
  let slug = slugify(baseSlug) || 'post';
  let candidate = slug;
  let n = 2;
  while (existingCheck(candidate)) {
    candidate = `${slug}-${n}`;
    n += 1;
  }
  return candidate;
}