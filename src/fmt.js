export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (n) => BRL.format(r2(n));
let hidden = false;
export const setHidden = (h) => (hidden = h);
export const isHidden = () => hidden;
/** valor que respeita o "ocultar valores" */
export const money = (n) => (hidden ? 'R$ •••••' : brl(n));

// datas como 'AAAA-MM-DD'
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseD = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => ymd();
export const ym = (s) => s.slice(0, 7);
export function addMonths(s, n, keepDay = null) {
  const d = parseD(s);
  const day = keepDay ?? d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return ymd(t);
}
export function addDays(s, n) {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
export const brDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
export const brShort = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (k) => `${MESES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
export const monthShort = (k) => `${MES3[+k.slice(5, 7) - 1]}/${k.slice(2, 4)}`;
export const shiftMonth = (k, n) => addMonths(k + '-01', n).slice(0, 7);
export function monthDays(k) {
  return [k + '-01', ymd(new Date(+k.slice(0, 4), +k.slice(5, 7), 0))];
}

export function dueLabel(s) {
  const d = daysBetween(today(), s);
  if (d < 0) return { t: d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`, c: 'late' };
  if (d === 0) return { t: 'vence hoje', c: 'today' };
  if (d === 1) return { t: 'vence amanhã', c: 'soon' };
  if (d <= 7) return { t: `em ${d} dias`, c: 'soon' };
  return { t: brDate(s), c: '' };
}

/** "1.234,56" → 1234.56 */
export function parseMoney(v) {
  if (typeof v === 'number') return r2(v);
  const s = String(v || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return r2(parseFloat(norm) || 0);
}
export const pct = (v) => (Number(v) * 100).toFixed(1).replace('.', ',') + '%';
