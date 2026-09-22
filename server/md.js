import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const allowedTags = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'u', 's', 'del', 'ins', 'blockquote', 'code', 'pre',
  'ul', 'ol', 'li', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr',
  'th', 'td', 'span', 'div', 'figure', 'figcaption', 'iframe',
];

const allowedAttributes = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen'],
  pre: ['class'],
  code: ['class'],
  span: ['class'],
  div: ['class'],
  table: ['class'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
};

export function mdToHtml(markdown) {
  const raw = marked.parse(String(markdown || ''), { async: false });
  return sanitizeHtml(raw, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

export function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}