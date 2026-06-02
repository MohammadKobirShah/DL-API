/**
 * Filename utilities — sanitize a video title for use as a download
 * filename, and build a tag-suffixed suggestion for the response.
 */

function sanitizeTitle(title) {
  if (!title || typeof title !== 'string') return 'video';
  let s = title
    // Strip characters that are illegal in NTFS / ext4 / FAT filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    // Collapse runs of whitespace
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 100) s = s.substring(0, 100).trim();
  return s || 'video';
}

function safeFilename(title, suffix, tag = null) {
  const base = sanitizeTitle(title);
  const tagPart = tag ? ` [${tag}]` : '';
  return `${base}${tagPart}.${suffix}`;
}

// RFC 6266 / RFC 5987 Content-Disposition: provide both an ASCII fallback
// (browsers on legacy systems) and a UTF-8 percent-encoded version for
// modern clients. Non-ASCII characters in `title` are preserved in the
// UTF-8 form only.
function buildContentDisposition(title, suffix, tag = null) {
  const asciiFallback = safeFilename(title, suffix, tag)
    // For the ASCII fallback, replace anything > 0x7F with a hyphen so
    // very old browsers don't choke on a 404 filename.
    .replace(/[^\x20-\x7e]/g, '-');
  const utf8Name = encodeURIComponent(safeFilename(title, suffix, tag))
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(?:7C|7E|60|5E)/g, (m) => m.toLowerCase());
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`;
}

module.exports = { sanitizeTitle, safeFilename, buildContentDisposition };
