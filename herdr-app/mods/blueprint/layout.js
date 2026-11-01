// Layered layout for small flowcharts (Sugiyama-style), in graph units (px at 100%).
//
//   1. cycles: DFS back edges are reversed for ranking and drawn as side arcs
//   2. ranks by longest path; sources move next to their nearest target
//   3. an edge longer than one rank gets a dummy point in each rank it crosses
//   4. order inside each rank by barycenter sweeps, keeping the fewest crossings
//   5. coordinates: ranks along the main axis, each node pulled toward its neighbours
//   6. edges as cubic beziers through their dummy points
//
// layout(g, "LR" | "TB", size(node) -> {w, h}, labelSize(edge) -> {w, h})
//   -> { nodes: [{node, x, y, w, h}], edges: [{e, segs, label, tip, dir}], bounds }

const SEP = { LR: 28, TB: 36 }; // between nodes across the main axis
const DUMMY_SEP = 14;
const GAP = { LR: 56, TB: 44 }; // between ranks along it

export function layout(g, dir, size, labelSize) {
  const LR = dir === "LR";
  const ids = [...g.nodes.keys()];
  const edges = g.edges.filter((e) => e.from !== e.to && g.nodes.has(e.from) && g.nodes.has(e.to));

  // 1. cycles
  const state = new Map(), back = new Set();
  const visit = (v) => {
    state.set(v, 1);
    for (const e of edges) {
      if (e.from !== v) continue;
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (!s) visit(e.to);
    }
    state.set(v, 2);
  };
  const hasIn = new Set(edges.map((e) => e.to));
  for (const id of ids) if (!hasIn.has(id) && !state.get(id)) visit(id);
  for (const id of ids) if (!state.get(id)) visit(id);
  const forward = edges.filter((e) => !back.has(e));

  // 2. ranks
  const rank = new Map(ids.map((id) => [id, 0]));
  const ranked = [...forward.map((e) => [e.from, e.to]), ...[...back].map((e) => [e.to, e.from])];
  for (let k = 0; k < ids.length; k++) {
    for (const [u, v] of ranked) if (rank.get(v) < rank.get(u) + 1) rank.set(v, rank.get(u) + 1);
  }
  const target = new Set(ranked.map(([, v]) => v));
  for (const id of ids) {
    if (target.has(id)) continue;
    const outs = ranked.filter(([u]) => u === id).map(([, v]) => rank.get(v));
    if (outs.length) rank.set(id, Math.max(0, Math.min(...outs) - 1));
  }
  const R = Math.max(0, ...rank.values()) + 1;

  // 3. dummies (forward edges only; back edges go around the side)
  const layers = Array.from({ length: R }, () => []);
  for (const id of ids) layers[rank.get(id)].push(id);
  const dummy = new Set();
  const up = new Map(ids.map((id) => [id, []])), down = new Map(ids.map((id) => [id, []]));
  const chains = forward.map((e, i) => {
    const chain = [e.from];
    for (let r = rank.get(e.from) + 1; r < rank.get(e.to); r++) {
      const id = `\u0000${i}:${r}`;
      dummy.add(id);
      rank.set(id, r);
      layers[r].push(id);
      up.set(id, []);
      down.set(id, []);
      chain.push(id);
    }
    chain.push(e.to);
    for (let k = 0; k + 1 < chain.length; k++) {
      down.get(chain[k]).push(chain[k + 1]);
      up.get(chain[k + 1]).push(chain[k]);
    }
    return chain;
  });

  // 4. order
  const crossings = () => {
    let c = 0;
    for (let r = 0; r + 1 < R; r++) {
      const pos = new Map(layers[r + 1].map((id, i) => [id, i]));
      const segs = [];
      layers[r].forEach((a, i) => down.get(a).forEach((b) => segs.push([i, pos.get(b)])));
      for (let x = 0; x < segs.length; x++) {
        for (let y = x + 1; y < segs.length; y++) if ((segs[x][0] - segs[y][0]) * (segs[x][1] - segs[y][1]) < 0) c++;
      }
    }
    return c;
  };
  let best = layers.map((l) => [...l]), fewest = crossings();
  for (let it = 0; it < 16 && fewest > 0; it++) {
    const downward = it % 2 === 0;
    for (let k = 1; k < R; k++) {
      const r = downward ? k : R - 1 - k;
      const pos = new Map(layers[downward ? r - 1 : r + 1].map((id, i) => [id, i]));
      const bc = new Map(layers[r].map((id, i) => {
        const nb = (downward ? up : down).get(id);
        return [id, nb.length ? nb.reduce((s, n) => s + pos.get(n), 0) / nb.length : i];
      }));
      layers[r].sort((a, b) => bc.get(a) - bc.get(b));
    }
    const c = crossings();
    if (c < fewest) {
      best = layers.map((l) => [...l]);
      fewest = c;
    }
  }
  best.forEach((l, r) => (layers[r] = l));

  // 5. coordinates
  const sz = new Map(ids.map((id) => [id, size(g.nodes.get(id))]));
  const along = (id) => (dummy.has(id) ? 0 : LR ? sz.get(id).w : sz.get(id).h);
  const across = (id) => (dummy.has(id) ? 0 : LR ? sz.get(id).h : sz.get(id).w);
  const apart = (a, b) => (across(a) + across(b)) / 2 + (dummy.has(a) || dummy.has(b) ? DUMMY_SEP : SEP[dir]);

  const labels = new Map(edges.filter((e) => e.label).map((e) => [e, labelSize(e)]));
  const gapAfter = Array(R).fill(GAP[dir]);
  for (const e of forward) {
    const l = labels.get(e);
    if (l) gapAfter[rank.get(e.from)] = Math.max(gapAfter[rank.get(e.from)], (LR ? l.w : l.h) + (LR ? 44 : 40));
  }
  const mainPos = [];
  let acc = 0;
  for (let r = 0; r < R; r++) {
    const ext = Math.max(0, ...layers[r].map(along));
    mainPos.push(acc + ext / 2);
    acc += ext + gapAfter[r];
  }

  const cross = new Map();
  for (const layer of layers) {
    let x = 0;
    layer.forEach((id, i) => {
      if (i) x += apart(layer[i - 1], id);
      cross.set(id, x);
    });
    for (const id of layer) cross.set(id, cross.get(id) - x / 2);
  }
  for (let it = 0; it < 24; it++) {
    const downward = it % 2 === 0;
    for (let k = 0; k < R; k++) {
      const layer = layers[downward ? k : R - 1 - k];
      const want = layer.map((id) => {
        const nb = [...up.get(id), ...down.get(id)];
        return nb.length ? nb.reduce((s, n) => s + cross.get(n), 0) / nb.length : cross.get(id);
      });
      // In order, at least `apart` from the previous one, then shifted so the
      // layer sits on what its nodes want, on average.
      const x = [...want];
      for (let i = 1; i < x.length; i++) x[i] = Math.max(x[i], x[i - 1] + apart(layer[i - 1], layer[i]));
      const shift = x.reduce((s, v, i) => s + v - want[i], 0) / x.length;
      layer.forEach((id, i) => cross.set(id, x[i] - shift));
    }
  }
  // A one-to-one link (a's only successor is b, b's only predecessor is a)
  // should be straight: line b up with a when its neighbours leave room.
  for (let round = 0; round < 2; round++) {
    for (let r = 1; r < R; r++) {
      const layer = layers[r];
      layer.forEach((b, i) => {
        if (up.get(b).length !== 1) return;
        const a = up.get(b)[0];
        if (down.get(a).length !== 1) return;
        let x = cross.get(a);
        if (i > 0) x = Math.max(x, cross.get(layer[i - 1]) + apart(layer[i - 1], b));
        if (i + 1 < layer.length) x = Math.min(x, cross.get(layer[i + 1]) - apart(b, layer[i + 1]));
        cross.set(b, x);
      });
    }
  }
  const P = new Map();
  for (const [id, r] of rank) P.set(id, LR ? { x: mainPos[r], y: cross.get(id) } : { x: cross.get(id), y: mainPos[r] });

  // 6. edges
  const box = (id) => ({ ...P.get(id), ...sz.get(id), shape: g.nodes.get(id).shape });
  const main = LR ? [1, 0] : [0, 1];
  // Several edges into (or out of) one side spread along it, in the order of
  // where they come from, instead of meeting in one point.
  const ins = new Map(), outs = new Map();
  forward.forEach((e, i) => {
    const ch = chains[i];
    if (!ins.has(e.to)) ins.set(e.to, []);
    if (!outs.has(e.from)) outs.set(e.from, []);
    ins.get(e.to).push({ i, at: P.get(ch[ch.length - 2]) });
    outs.get(e.from).push({ i, at: P.get(ch[1]) });
  });
  const spread = (map, id, i) => {
    const list = map.get(id) ?? [];
    if (list.length < 2 || g.nodes.get(id).shape === "diamond") return 0;
    const key = (p) => (LR ? p.at.y : p.at.x);
    list.sort((a, b) => key(a) - key(b));
    const step = Math.min(18, ((LR ? sz.get(id).h : sz.get(id).w) * 0.5) / (list.length - 1));
    return (list.findIndex((x) => x.i === i) - (list.length - 1) / 2) * step;
  };
  const shift = (p, d) => (LR ? { x: p.x, y: p.y + d } : { x: p.x + d, y: p.y });
  const out = [];
  forward.forEach((e, i) => {
    const pts = chains[i].map((id) => ({ ...P.get(id) }));
    const u = box(e.from), v = box(e.to);
    const start = exitPort(u, pts[1], LR), end = entryPort(v, LR);
    if (!(u.shape === "diamond" && (LR ? start.t[1] : start.t[0]))) start.p = shift(start.p, spread(outs, e.from, i));
    end.p = shift(end.p, spread(ins, e.to, i));
    pts[0] = start.p;
    pts[pts.length - 1] = end.p;
    const tan = pts.map((_, k) => (k === 0 ? start.t : k === pts.length - 1 ? end.t : main));
    const segs = [];
    for (let k = 0; k + 1 < pts.length; k++) segs.push(bezier(pts[k], pts[k + 1], tan[k], tan[k + 1]));
    const last = segs[segs.length - 1];
    out.push({ e, segs, label: e.label ? at(segs[0], 0.45) : null, tip: last[3], dir: norm(sub(last[3], last[2])) });
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y, hw = 0, hh = 0) => {
    minX = Math.min(minX, x - hw); maxX = Math.max(maxX, x + hw);
    minY = Math.min(minY, y - hh); maxY = Math.max(maxY, y + hh);
  };
  for (const id of ids) grow(P.get(id).x, P.get(id).y, sz.get(id).w / 2 + 10, sz.get(id).h / 2 + 10);

  // Back edges: an arc outside everything they span, on the far side.
  for (const e of back) {
    const a = box(e.from), b = box(e.to);
    const lo = Math.min(rank.get(e.from), rank.get(e.to)), hi = Math.max(rank.get(e.from), rank.get(e.to));
    let side = -Infinity;
    for (const id of ids) {
      if (rank.get(id) < lo || rank.get(id) > hi) continue;
      side = Math.max(side, LR ? P.get(id).y + sz.get(id).h / 2 : P.get(id).x + sz.get(id).w / 2);
    }
    side += 36;
    const p0 = LR ? { x: a.x, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: a.y };
    const p3 = LR ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y };
    const seg = LR
      ? [p0, { x: p0.x, y: side }, { x: p3.x, y: side }, p3]
      : [p0, { x: side, y: p0.y }, { x: side, y: p3.y }, p3];
    out.push({ e, segs: [seg], label: e.label ? at(seg, 0.5) : null, tip: p3, dir: norm(sub(p3, seg[2])), back: true });
    grow(LR ? p0.x : side, LR ? side : p0.y, 4, 4);
  }
  for (const ed of out) {
    const l = ed.label && labels.get(ed.e);
    if (l) grow(ed.label.x, ed.label.y, l.w / 2, l.h / 2);
  }

  return {
    nodes: ids.map((id) => ({ node: g.nodes.get(id), ...P.get(id), ...sz.get(id) })),
    edges: out,
    bounds: { minX, minY, maxX, maxY },
  };
}

// Where an edge leaves `u` toward `next`, and its direction there. A diamond
// branching up or down leaves from that corner (the "yes / no" look).
function exitPort(u, next, LR) {
  if (LR) {
    if (u.shape === "diamond" && Math.abs(next.y - u.y) > u.h / 4) {
      const s = Math.sign(next.y - u.y);
      return { p: { x: u.x, y: u.y + (s * u.h) / 2 }, t: [0, s] };
    }
    return { p: { x: u.x + u.w / 2, y: u.y }, t: [1, 0] };
  }
  if (u.shape === "diamond" && Math.abs(next.x - u.x) > u.w / 4) {
    const s = Math.sign(next.x - u.x);
    return { p: { x: u.x + (s * u.w) / 2, y: u.y }, t: [s, 0] };
  }
  return { p: { x: u.x, y: u.y + u.h / 2 }, t: [0, 1] };
}

function entryPort(v, LR) {
  return LR ? { p: { x: v.x - v.w / 2, y: v.y }, t: [1, 0] } : { p: { x: v.x, y: v.y - v.h / 2 }, t: [0, 1] };
}

function bezier(p0, p1, t0, t1) {
  const d = sub(p1, p0);
  const k0 = Math.max(16, Math.abs(d.x * t0[0] + d.y * t0[1]) * 0.5);
  const k1 = Math.max(16, Math.abs(d.x * t1[0] + d.y * t1[1]) * 0.5);
  return [p0, { x: p0.x + t0[0] * k0, y: p0.y + t0[1] * k0 }, { x: p1.x - t1[0] * k1, y: p1.y - t1[1] * k1 }, p1];
}

export function at([a, b, c, d], t) {
  const s = 1 - t;
  return {
    x: s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x,
    y: s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y,
  };
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
