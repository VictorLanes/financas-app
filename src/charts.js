import { esc, brl, isHidden } from './fmt.js';

/** Rosca (SVG) com legenda */
export function donut(items, total, { size = 150, center = '' } = {}) {
  if (!total) return '<p class="muted small center">Sem dados no período.</p>';
  const r = 54, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = items.slice(0, 8).map((it) => {
    const len = (it.v / total) * c;
    const s = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${it.cat.color}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
    off += len;
    return s;
  });
  const rest = items.slice(8).reduce((s, x) => s + x.v, 0);
  if (rest > 0) arcs.push(`<circle r="${r}" cx="70" cy="70" fill="none" stroke="#cbd5e1" stroke-width="22" stroke-dasharray="${(rest / total) * c} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`);
  return `<div class="donut-wrap">
    <svg viewBox="0 0 140 140" width="${size}" height="${size}">${arcs.join('')}
      <text x="70" y="66" text-anchor="middle" class="donut-t1">Total</text>
      <text x="70" y="84" text-anchor="middle" class="donut-t2">${esc(center)}</text></svg>
    <div class="legend">${items.slice(0, 6).map((it) => `<div><span class="dot" style="background:${it.cat.color}"></span><span class="grow">${it.cat.icon} ${esc(it.cat.name)}</span><b>${Math.round((it.v / total) * 100)}%</b></div>`).join('')}</div>
  </div>`;
}

/** Barras receitas x despesas por mês */
export function bars(months) {
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const H = 110, bw = 14, gap = 10, group = bw * 2 + 6 + gap;
  const W = months.length * group;
  const b = months.map((m, i) => {
    const x = i * group + gap / 2;
    const hi = (m.income / max) * H, he = (m.expense / max) * H;
    const lbl = m.k.slice(5, 7) + '/' + m.k.slice(2, 4);
    return `<rect x="${x}" y="${H - hi}" width="${bw}" height="${hi}" rx="3" fill="#22c55e"/>
      <rect x="${x + bw + 3}" y="${H - he}" width="${bw}" height="${he}" rx="3" fill="#f43f5e"/>
      <text x="${x + bw + 1.5}" y="${H + 14}" text-anchor="middle" class="bar-lbl">${lbl}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="bars" preserveAspectRatio="xMidYMid meet">${b.join('')}</svg>
    <div class="row center-row small muted"><span class="dot" style="background:#22c55e"></span>Receitas <span class="dot" style="background:#f43f5e;margin-left:12px"></span>Despesas</div>`;
}

export const progress = (p, color) => `<div class="prog"><i style="width:${Math.min(100, Math.max(0, p * 100))}%;${color ? `background:${color}` : ''}"></i></div>`;
export const hideable = (n) => (isHidden() ? 'R$ •••••' : brl(n));
