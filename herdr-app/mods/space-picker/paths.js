// Pure path/search helpers; no filesystem access or shell interpolation.
export function normalize(value, home) {
  let path = value.trim();
  if (path === '~') path = home;
  else if (path.startsWith('~/')) path = home + path.slice(1);
  if (!path.startsWith('/')) return null;
  // Preserve . and ..: lexical resolution changes the meaning across symlinks.
  return path.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

export function display(path, home) {
  return path === home ? '~' : path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
}

export function completion(value, home) {
  const path = normalize(value, home);
  if (!path) return null;
  if (value.trim().endsWith('/') || value.trim() === '~' || /\/\.\.$/.test(path)) return { dir: path, prefix: '' };
  const slash = path.lastIndexOf('/');
  return { dir: path.slice(0, slash) || '/', prefix: path.slice(slash + 1).toLowerCase() };
}

// Ranks by fewest fuzzy tokens, then folder-name prefix, then path. Keeps only the best `limit`
// matches (insertion into a small sorted list) so large indexes are never fully sorted.
export function search(paths, query, home, limit = Infinity) {
  const needle = query.trim().toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  const best = [];
  const compare = (a, b) => a.fuzzy - b.fuzzy || b.prefix - a.prefix || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const path of new Set(paths)) {
    const text = display(path, home).toLowerCase();
    const segments = text.split('/');
    let fuzzy = 0;
    let matched = true;
    for (const token of tokens) {
      if (text.includes(token)) continue;
      // Match missing letters within a single folder segment, not across unrelated parents.
      if (token.length < 3 || !segments.some(segment => subsequence(token, segment))) {
        matched = false; break;
      }
      fuzzy++;
    }
    if (!matched) continue;
    const result = { path, fuzzy, prefix: Number(segments[segments.length - 1].startsWith(needle)) };
    if (best.length >= limit && compare(result, best[best.length - 1]) >= 0) continue;
    let at = best.length;
    while (at > 0 && compare(result, best[at - 1]) < 0) at--;
    best.splice(at, 0, result);
    if (best.length > limit) best.pop();
  }
  return best.map(result => result.path);
}

function subsequence(needle, text) {
  let at = 0;
  for (const character of text) if (character === needle[at]) at++;
  return at === needle.length;
}
