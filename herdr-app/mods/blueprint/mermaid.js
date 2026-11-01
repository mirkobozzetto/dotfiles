// Mermaid flowchart subset -> { title, dir, nodes: Map<id, node>, edges: [] }.
//
// Nodes:  id[rect]  id(round)  id([stadium])  id[(cylinder)]  id((circle))  id{diamond}
//         "Title<br/>subtitle" splits into title and sub.
// Edges:  -->  ---  -.->  -.-  ==>   with |label|, or "-- label -->" / "-. label .->".
// Blueprint extras stay plain Mermaid: "class a,b done|active|current", the code a
// box stands for as `%% code: id path:line` (or click id "path:line"), and a
// frontmatter title. Each node keeps the line it is written on (1-based, in src).

const SHAPES = [
  ["([", "])", "stadium"],
  ["[(", ")]", "cylinder"],
  ["((", "))", "circle"],
  ["[", "]", "rect"],
  ["(", ")", "round"],
  ["{", "}", "diamond"],
];

const EDGES = [
  [/^\s*-->\s*(?:\|([^|]*)\|)?/, "solid", true],
  [/^\s*-\.->\s*(?:\|([^|]*)\|)?/, "dashed", true],
  [/^\s*==>\s*(?:\|([^|]*)\|)?/, "thick", true],
  [/^\s*---\s*(?:\|([^|]*)\|)?/, "solid", false],
  [/^\s*-\.-\s*(?:\|([^|]*)\|)?/, "dashed", false],
  [/^\s*--\s+([^>]+?)\s+-->/, "solid", true],
  [/^\s*-\.\s+([^>]+?)\s+\.->/, "dashed", true],
];

const unquote = (s) => {
  s = s.trim();
  return s.length > 1 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
};

// Characters written as entities, the HTML way (&lt; &#60;) or Mermaid's
// (#lt; #60;): agents use both to keep < > " out of the syntax.
const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
export function decode(s) {
  if (!s || !/[&#]/.test(s)) return s;
  return s.replace(/&#x([0-9a-f]+);|[&#]#?(\d+);|[&#](lt|gt|amp|quot|apos|nbsp);/gi, (all, hex, dec, name) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : NAMED[name.toLowerCase()] ?? all);
}

export function parseFlowchart(src) {
  const g = { title: null, dir: "LR", nodes: new Map(), edges: [], src };
  const raw = src.split("\n");
  const lines = raw.map((l) => l.trim());
  let i = Math.max(0, lines.findIndex(Boolean)); // blank lines may come first
  if (lines[i] === "---") {
    for (i++; i < lines.length && lines[i] !== "---"; i++) {
      const m = lines[i].match(/^title:\s*(.+)$/);
      if (m) g.title = decode(unquote(m[1]));
    }
    i++;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/;$/, "");
    let m;
    if ((m = line.match(/^%%\s*code:\s*(\w+)\s+(\S.*?)\s*$/))) {
      node(g, m[1]).ref = m[2];
      continue;
    }
    if (!line || line.startsWith("%%")) continue;
    // The header; with no direction Mermaid draws top to bottom.
    if ((m = line.match(/^(?:flowchart|graph)(?:\s+(LR|RL|TB|TD|BT)\b.*|\s*)$/))) {
      g.dir = m[1] === "LR" || m[1] === "RL" ? "LR" : "TB";
      continue;
    }
    if ((m = line.match(/^class\s+([\w,\s]+?)\s+(\w+)$/))) {
      for (const id of m[1].split(",")) Object.assign(node(g, id.trim()), { status: m[2], statusAt: i });
      continue;
    }
    if ((m = line.match(/^click\s+(\w+)\s+(?:href\s+)?"([^"]+)"/))) {
      node(g, m[1]).ref = m[2];
      continue;
    }
    if (/^(classDef|style|linkStyle|subgraph|end|direction)\b/.test(line)) continue;
    statement(g, line, { line: i + 1, text: raw[i] });
  }
  return g;
}

function node(g, id) {
  let n = g.nodes.get(id);
  if (!n) {
    n = { id, shape: "rect", title: id, sub: null, status: null, ref: null, line: null, lineText: null };
    g.nodes.set(id, n);
  }
  return n;
}

// One node at s[pos] (with its shape, if written there): [id, next pos] or null.
function readNode(g, s, pos, at) {
  const m = /^\s*(\w+)/.exec(s.slice(pos));
  if (!m) return null;
  const id = m[1];
  pos += m[0].length;
  const n = node(g, id);
  for (const [open, close, shape] of SHAPES) {
    if (!s.startsWith(open, pos)) continue;
    // A quoted label may hold the closing bracket: a["arr[0]"], a("f()").
    const q = /^\s*"/.exec(s.slice(pos + open.length));
    const shut = q ? s.indexOf('"', pos + open.length + q[0].length) : -1;
    const end = s.indexOf(close, shut >= 0 ? shut + 1 : pos + open.length);
    if (end < 0) break;
    const [title, ...rest] = unquote(s.slice(pos + open.length, end)).split(/<br\s*\/?>/i);
    Object.assign(n, { shape, title: decode(title.trim()), sub: decode(rest.join(" ").trim()) || null });
    if (!n.line) Object.assign(n, { line: at.line, lineText: at.text });
    return [id, end + close.length];
  }
  return [id, pos];
}

// "a --> b -->|x| c": a chain of nodes joined by edges.
function statement(g, s, at) {
  let r = readNode(g, s, 0, at);
  while (r) {
    const [from, pos] = r;
    let hit = null;
    for (const [re, style, arrow] of EDGES) {
      const m = re.exec(s.slice(pos));
      if (m) {
        hit = { len: m[0].length, label: decode(unquote(m[1] ?? "")) || null, style, arrow };
        break;
      }
    }
    if (!hit) return;
    const next = readNode(g, s, pos + hit.len, at);
    if (!next) return;
    g.edges.push({ from, to: next[0], label: hit.label, style: hit.style, arrow: hit.arrow });
    r = next;
  }
}
