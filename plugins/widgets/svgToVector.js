/**
 * MOB-30: Bao and Bun stills for the Android widgets. Converts the mascot SVGs in
 * design-handoff/assets/mascot (a small subset of SVG: g with translate/scale, path, circle,
 * ellipse, rect, fill, stroke, opacity) to Android VectorDrawable XML at prebuild, so the widget
 * art is always the hand-off art. Not a general converter: anything else throws, so a new kind of
 * element in the art fails prebuild instead of silently dropping a part.
 */

const SUPPORTED = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect']);

/** Tiny XML reader for the hand-off SVGs: elements, attributes, nesting. */
function parse(svg) {
  const root = { name: 'root', attrs: {}, children: [] };
  const stack = [root];
  const tag =
    /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let m;
  while ((m = tag.exec(svg))) {
    if (!m[2]) continue; // comment or declaration
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`svgToVector: unbalanced </${name}>`);
      continue;
    }
    if (!SUPPORTED.has(name)) throw new Error(`svgToVector: unsupported element <${name}>`);
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const svgNode = root.children.find((c) => c.name === 'svg');
  if (!svgNode) throw new Error('svgToVector: no <svg>');
  return svgNode;
}

/** "translate(10 57) scale(0.62)" -> VectorDrawable group attributes (scale first, then move). */
function groupTransform(transform) {
  if (!transform) return {};
  const out = {};
  const parts = [...transform.matchAll(/(\w+)\(([^)]*)\)/g)];
  parts.forEach(([, fn, args], i) => {
    const n = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (fn === 'translate') {
      // A translate after a scale would need the scale applied to it: not in the art.
      if (i > 0 && parts[0][1] === 'scale') throw new Error('svgToVector: scale before translate');
      out.translateX = n[0] ?? 0;
      out.translateY = n[1] ?? 0;
    } else if (fn === 'scale') {
      out.scaleX = n[0] ?? 1;
      out.scaleY = n[1] ?? n[0] ?? 1;
    } else throw new Error(`svgToVector: unsupported transform ${fn}`);
  });
  return out;
}

const num = (v, d = 0) => (v === undefined ? d : Number(v));
const fmt = (n) => String(Math.round(n * 1000) / 1000);

function ellipsePath(cx, cy, rx, ry) {
  return (
    `M${fmt(cx - rx)},${fmt(cy)} ` +
    `A${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(cx + rx)},${fmt(cy)} ` +
    `A${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(cx - rx)},${fmt(cy)} Z`
  );
}

function rectPath(x, y, w, h, rx, ry) {
  if (!rx && !ry) return `M${fmt(x)},${fmt(y)} H${fmt(x + w)} V${fmt(y + h)} H${fmt(x)} Z`;
  const a = Math.min(rx || ry, w / 2);
  const b = Math.min(ry || rx, h / 2);
  return [
    `M${fmt(x + a)},${fmt(y)}`,
    `H${fmt(x + w - a)}`,
    `A${fmt(a)},${fmt(b)} 0 0 1 ${fmt(x + w)},${fmt(y + b)}`,
    `V${fmt(y + h - b)}`,
    `A${fmt(a)},${fmt(b)} 0 0 1 ${fmt(x + w - a)},${fmt(y + h)}`,
    `H${fmt(x + a)}`,
    `A${fmt(a)},${fmt(b)} 0 0 1 ${fmt(x)},${fmt(y + h - b)}`,
    `V${fmt(y + b)}`,
    `A${fmt(a)},${fmt(b)} 0 0 1 ${fmt(x + a)},${fmt(y)}`,
    'Z',
  ].join(' ');
}

function pathData(node) {
  const a = node.attrs;
  switch (node.name) {
    case 'path':
      return a.d;
    case 'circle':
      return ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r));
    case 'ellipse':
      return ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    case 'rect':
      return rectPath(
        num(a.x),
        num(a.y),
        num(a.width),
        num(a.height),
        num(a.rx, undefined),
        num(a.ry, undefined),
      );
    default:
      return null;
  }
}

const LINECAP = { round: 'round', square: 'square', butt: 'butt' };
const LINEJOIN = { round: 'round', bevel: 'bevel', miter: 'miter' };

function shape(node, indent, opacity) {
  const a = node.attrs;
  const alpha = opacity * num(a.opacity, 1);
  // SVG fills black by default; "none" means no fill.
  const fill = a.fill === undefined ? '#000000' : a.fill;
  const lines = [`${indent}<path`, `${indent}    android:pathData="${pathData(node)}"`];
  if (fill !== 'none') {
    lines.push(`${indent}    android:fillColor="${fill}"`);
    const fillAlpha = alpha * num(a['fill-opacity'], 1);
    if (fillAlpha !== 1) lines.push(`${indent}    android:fillAlpha="${fmt(fillAlpha)}"`);
  }
  if (a.stroke && a.stroke !== 'none') {
    lines.push(`${indent}    android:strokeColor="${a.stroke}"`);
    lines.push(`${indent}    android:strokeWidth="${fmt(num(a['stroke-width'], 1))}"`);
    const strokeAlpha = alpha * num(a['stroke-opacity'], 1);
    if (strokeAlpha !== 1) lines.push(`${indent}    android:strokeAlpha="${fmt(strokeAlpha)}"`);
    if (LINECAP[a['stroke-linecap']])
      lines.push(`${indent}    android:strokeLineCap="${LINECAP[a['stroke-linecap']]}"`);
    if (LINEJOIN[a['stroke-linejoin']])
      lines.push(`${indent}    android:strokeLineJoin="${LINEJOIN[a['stroke-linejoin']]}"`);
    // stroke-dasharray has no VectorDrawable equivalent: the empty seat is drawn solid.
  }
  lines[lines.length - 1] += ' />';
  return lines.join('\n');
}

function children(nodes, indent, opacity) {
  return nodes
    .map((node) => {
      if (node.name !== 'g') return shape(node, indent, opacity);
      const t = groupTransform(node.attrs.transform);
      const attrs = Object.entries(t).map(([k, v]) => `\n${indent}    android:${k}="${fmt(v)}"`);
      const inner = children(node.children, `${indent}    `, opacity * num(node.attrs.opacity, 1));
      return `${indent}<group${attrs.join('')}>\n${inner}\n${indent}</group>`;
    })
    .join('\n');
}

/** SVG text -> VectorDrawable XML (`sizeDp` square). */
function svgToVector(svg, { sizeDp = 120, comment } = {}) {
  const root = parse(svg);
  const [, , vw, vh] = (root.attrs.viewBox ?? '0 0 120 120').split(/[\s,]+/).map(Number);
  const head = comment ? `<!-- ${comment} -->\n` : '';
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n${head}` +
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n` +
    `    android:width="${sizeDp}dp"\n    android:height="${sizeDp}dp"\n` +
    `    android:viewportWidth="${fmt(vw)}"\n    android:viewportHeight="${fmt(vh)}">\n` +
    `${children(root.children, '    ', num(root.attrs.opacity, 1))}\n</vector>\n`
  );
}

module.exports = { svgToVector };
