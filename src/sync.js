/*
 * Sincronização com a planilha do Google (via Google Apps Script).
 *
 * Cada item (lançamento, conta, cartão...) guarda "u" = quando foi alterado.
 * Itens apagados ficam em "deleted" (id -> quando). Na sincronização os dois lados
 * são juntados item por item: vale a versão mais recente. Assim o celular e o
 * computador podem ser usados ao mesmo tempo, até sem internet.
 */
import { db, SYNC_COLLS } from './db.js';

const listeners = new Set();
export const status = { state: 'off', last: 0, error: '' };
const setStatus = (p) => {
  Object.assign(status, p);
  listeners.forEach((fn) => fn(status));
};
export const onStatus = (fn) => listeners.add(fn);

export function cfg() {
  return db.s.sync || {};
}
export function configured() {
  const c = cfg();
  return !!(c.url && c.key && c.enabled !== false);
}

/** Junta dois documentos item a item (o mais recente vence). Igual ao Code.gs. */
export function mergeDocs(a, b) {
  if (!a) return b;
  if (!b) return a;
  const deleted = { ...(a.deleted || {}) };
  for (const [id, t] of Object.entries(b.deleted || {})) if (!deleted[id] || deleted[id] < t) deleted[id] = t;
  const out = { deleted };
  for (const c of SYNC_COLLS) {
    const map = new Map();
    for (const it of a[c] || []) map.set(it.id, it);
    for (const it of b[c] || []) {
      const cur = map.get(it.id);
      if (!cur || (it.u || 0) > (cur.u || 0)) map.set(it.id, it);
    }
    out[c] = [...map.values()].filter((it) => !(deleted[it.id] && deleted[it.id] >= (it.u || 0)));
  }
  const bu = (b.budgetsU || 0) > (a.budgetsU || 0);
  out.budgets = bu ? b.budgets || {} : a.budgets || {};
  out.budgetsU = Math.max(a.budgetsU || 0, b.budgetsU || 0);
  // apaga lembranças de exclusão muito antigas (mais de 1 ano)
  const old = Date.now() - 365 * 864e5;
  for (const [id, t] of Object.entries(out.deleted)) if (t < old) delete out.deleted[id];
  return out;
}

const hasData = (doc) => doc && (doc.txs?.length || doc.cards?.length || doc.debts?.length || doc.goals?.length);
const canon = (doc) => JSON.stringify([SYNC_COLLS.map((c) => (doc[c] || []).map((x) => x.id + ':' + (x.u || 0)).sort()), doc.budgetsU || 0, Object.keys(doc.deleted || {}).length]);

async function call(action, extra = {}, c = cfg()) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: c.key, ...extra }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j;
    try {
      j = JSON.parse(txt);
    } catch {
      throw new Error(txt.includes('<html') || txt.includes('<!DOCTYPE') ? 'O link não é de um App da Web publicado para "Qualquer pessoa".' : 'Resposta inválida da planilha.');
    }
    if (!j.ok) throw new Error(j.error || 'Erro na planilha');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A planilha demorou demais para responder.');
    if (e instanceof TypeError) throw new Error('Sem conexão com a internet ou link inválido.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Testa a conexão (e registra a chave na primeira vez) */
export async function testConnection(url, key) {
  return call('ping', {}, { url, key });
}

let running = null;
let again = false;
export async function syncNow({ silent = true } = {}) {
  if (!configured()) return false;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus({ state: 'syncing', error: '' });
    try {
      const remote = await call('pull');
      const remoteDoc = remote.doc || null;
      let local = db.syncDoc();
      if (db.pristine) {
        // aparelho novo/vazio: recebe exatamente o que está na planilha (não envia os dados de exemplo)
        if (hasData(remoteDoc)) await db.applySync(remoteDoc);
        setStatus({ state: 'ok', last: Date.now() });
        saveLast();
        return true;
      }
      const merged = mergeDocs(local, remoteDoc);
      let final = merged;
      if (!remoteDoc || canon(merged) !== canon(remoteDoc)) {
        const res = await call('push', { doc: merged });
        final = res.doc || merged;
      }
      // aplica só se algo mudou em relação ao que está no aparelho
      local = db.syncDoc();
      const latest = mergeDocs(local, final);
      if (canon(latest) !== canon(local) || db.pristine) await db.applySync(latest);
      setStatus({ state: 'ok', last: Date.now() });
      saveLast();
      return true;
    } catch (e) {
      console.warn('sync', e);
      setStatus({ state: 'error', error: e.message || String(e) });
      return false;
    }
  })();
  const r = await running;
  running = null;
  if (again) {
    again = false;
    setTimeout(() => syncNow(), 500);
  }
  return r;
}

function saveLast() {
  const c = cfg();
  db.d.settings.sync = { ...c, last: Date.now() };
  db.save();
}

let timer = null;
/** agenda uma sincronização logo após uma alteração local */
export function scheduleSync(ms = 2500) {
  if (!configured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

// ---------- código de configuração (para passar do computador para o celular) ----------
export function configCode() {
  const c = cfg();
  return 'MF1:' + btoa(unescape(encodeURIComponent(JSON.stringify({ u: c.url, k: c.key }))));
}
export function parseConfigCode(code) {
  const s = String(code || '').trim();
  const m = s.match(/MF1:([A-Za-z0-9+/=]+)/);
  if (!m) throw new Error('Código inválido. Ele começa com MF1:');
  const j = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
  if (!j.u || !j.k) throw new Error('Código incompleto.');
  return { url: j.u, key: j.k };
}
export function randomKey() {
  const a = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('');
}
