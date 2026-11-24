import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from './db.js';
import { brl, today, ym, monthLabel, addDays, parseD, esc } from './fmt.js';
import { toast, actionSheet } from './ui.js';

export const native = Capacitor.isNativePlatform();
const WidgetBridge = registerPlugin('WidgetBridge');
const CHANNEL = 'vencimentos';

// ======================================================================
// Notificações de vencimento
// ======================================================================
export async function initNative(onLink) {
  if (native) {
    try {
      await LocalNotifications.createChannel({ id: CHANNEL, name: 'Vencimentos', description: 'Avisos de contas, faturas e parcelas', importance: 5, visibility: 0, vibration: true });
      await LocalNotifications.addListener('localNotificationActionPerformed', () => onLink('financas://contas'));
      const p = await LocalNotifications.checkPermissions();
      if (p.display !== 'granted') setTimeout(() => LocalNotifications.requestPermissions().then(() => syncNotifications()), 1200);
    } catch (e) {
      console.error(e);
    }
    App.addListener('appUrlOpen', ({ url }) => onLink(url));
    try {
      const l = await App.getLaunchUrl();
      if (l?.url) setTimeout(() => onLink(l.url), 300);
    } catch {}
    let hiddenAt = 0;
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        hiddenAt = Date.now();
        writeWidget();
        return;
      }
      if (db.s.pin && Date.now() - hiddenAt > 30000) lockNow();
    });
  }
}

export async function notifStatus() {
  if (!native) return { ok: false, label: 'só no app instalado' };
  const p = await LocalNotifications.checkPermissions();
  let exact = 'granted';
  try {
    exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm;
  } catch {}
  return p.display === 'granted' ? { ok: true, label: exact === 'granted' ? 'Ativadas ✓' : 'Ativadas (horário aproximado)' } : { ok: false, label: 'Desativadas' };
}
export async function askNotif() {
  if (!native) return;
  const p = await LocalNotifications.requestPermissions();
  if (p.display !== 'granted') toast('Ative em Configurações > Apps > Minhas Finanças > Notificações');
  syncNotifications();
}
export async function exactAlarmSettings() {
  if (native) await LocalNotifications.changeExactNotificationSetting().catch(() => {});
}
export async function testNotif() {
  if (!native) return false;
  await LocalNotifications.schedule({ notifications: [{ id: 99999, title: '✅ Notificações funcionando', body: 'Você vai receber avisos antes dos vencimentos.', channelId: CHANNEL, smallIcon: 'ic_stat_notify', iconColor: '#7c3aed', schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true } }] });
  return true;
}

let syncing = null;
export async function syncNotifications() {
  if (!native) return;
  if (syncing) await syncing;
  syncing = (async () => {
    try {
      const pend = await LocalNotifications.getPending();
      const ours = pend.notifications.filter((n) => n.id >= 1000 && n.id < 90000);
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return;
      const days = +db.s.reminderDays || 0, hour = +db.s.reminderHour || 9;
      const now = Date.now() + 5000;
      const items = db.dues({ until: addDays(today(), 75) }).filter((d) => d.due >= today());
      const list = [];
      const at = (s, h) => {
        const d = parseD(s);
        d.setHours(h, 0, 0, 0);
        return d;
      };
      // agrupa por dia para não lotar de notificações
      const byDay = {};
      items.forEach((d) => (byDay[d.due] = byDay[d.due] || []).push(d));
      let id = 1000;
      for (const [due, arr] of Object.entries(byDay).sort()) {
        const out = arr.filter((x) => x.dir === 'out'), inc = arr.filter((x) => x.dir === 'in');
        const mk = (when, prefix) => {
          if (out.length) {
            const tot = out.reduce((s, x) => s + x.amount, 0);
            const title = out.length === 1 ? `${prefix} ${out[0].title}` : `${prefix} ${out.length} contas`;
            const body = out.length === 1 ? `${brl(out[0].amount)}${out[0].sub ? ' · ' + out[0].sub : ''}` : `${brl(tot)}: ${out.map((x) => x.title).slice(0, 4).join(', ')}`;
            list.push({ id: id++, title, body, largeBody: out.map((x) => `• ${x.title}: ${brl(x.amount)}`).join('\n'), channelId: CHANNEL, smallIcon: 'ic_stat_notify', iconColor: '#7c3aed', schedule: { at: when, allowWhileIdle: true } });
          }
          if (inc.length) {
            list.push({ id: id++, title: `${prefix.replace('Vence', 'Receber')} ${inc.length === 1 ? inc[0].title : inc.length + ' valores'}`, body: brl(inc.reduce((s, x) => s + x.amount, 0)), channelId: CHANNEL, smallIcon: 'ic_stat_notify', iconColor: '#16a34a', schedule: { at: when, allowWhileIdle: true } });
          }
        };
        const dayOf = at(due, hour);
        if (days > 0) {
          const before = at(addDays(due, -days), hour);
          if (before.getTime() > now) mk(before, days === 1 ? '⏰ Vence amanhã:' : `⏰ Vence em ${days} dias:`);
        }
        if (dayOf.getTime() > now) mk(dayOf, '🔔 Vence hoje:');
        if (list.length > 60) break;
      }
      if (list.length) await LocalNotifications.schedule({ notifications: list.slice(0, 64) });
    } catch (e) {
      console.error('notificações', e);
    }
  })();
  await syncing;
  syncing = null;
}

// ======================================================================
// Widgets: o app grava um resumo que os widgets nativos leem
// ======================================================================
export async function writeWidget() {
  const k = ym(today());
  const m = db.monthStats(k);
  const items = db.dues({ until: addDays(today(), 45) }).slice(0, 20).map((d) => ({ t: d.title, a: d.amount, d: d.due, dir: d.dir }));
  const data = { hide: !!db.s.widgetHide, balance: db.totalBalance(), month: monthLabel(k), income: m.income, expense: m.expense, items, at: Date.now() };
  await Preferences.set({ key: 'widget_data', value: JSON.stringify(data) });
  if (native) WidgetBridge.refresh().catch(() => {});
}

let t = null;
export function afterChange() {
  clearTimeout(t);
  t = setTimeout(() => {
    writeWidget();
    syncNotifications();
  }, 700);
}

// ======================================================================
// PIN
// ======================================================================
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function pinPad({ title, sub = '', cancel = true, check = null }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'lock';
    let v = '';
    const draw = (msg = sub, err = false) => {
      el.innerHTML = `<div class="lock-box"><div class="lock-logo">💜</div><h2>${esc(title)}</h2><p class="${err ? 'expense' : 'muted'} small">${esc(msg)}</p>
        <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < v.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
          <button data-k="c" class="kp-ghost">${cancel ? 'Cancelar' : ''}</button><button data-k="0">0</button><button data-k="b" class="kp-ghost">⌫</button></div></div>`;
    };
    draw();
    document.body.appendChild(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'c') {
        if (!cancel) return;
        el.remove();
        return resolve(null);
      }
      if (k === 'b') v = v.slice(0, -1);
      else if (v.length < 4) v += k;
      draw();
      if (v.length === 4) {
        if (check && !(await check(v))) {
          v = '';
          if (navigator.vibrate) navigator.vibrate(200);
          return draw('PIN incorreto', true);
        }
        el.remove();
        resolve(v);
      }
    });
  });
}

let locked = false;
export async function lockNow() {
  if (locked || !db.s.pin) return;
  locked = true;
  const { salt, hash } = db.s.pin;
  await pinPad({ title: 'Minhas Finanças', sub: 'Digite seu PIN', cancel: false, check: async (p) => (await hashPin(p, salt)) === hash });
  locked = false;
}
export async function checkLock() {
  if (db.s.pin) await lockNow();
}
export async function setupPin() {
  if (db.s.pin) {
    const v = await actionSheet({ items: [{ label: 'Alterar PIN', value: 'change' }, { label: 'Remover PIN', value: 'remove', danger: true }] });
    if (!v) return;
    const { salt, hash } = db.s.pin;
    const ok = await pinPad({ title: 'PIN atual', check: async (p) => (await hashPin(p, salt)) === hash });
    if (!ok) return;
    if (v === 'remove') {
      db.setSettings({ pin: null });
      return toast('PIN removido');
    }
  }
  const p1 = await pinPad({ title: 'Novo PIN', sub: 'Escolha 4 números' });
  if (!p1) return;
  const p2 = await pinPad({ title: 'Confirme o PIN', sub: 'Digite de novo' });
  if (!p2) return;
  if (p1 !== p2) return toast('Os PINs não conferem');
  const salt = Math.random().toString(36).slice(2);
  db.setSettings({ pin: { salt, hash: await hashPin(p1, salt) } });
  toast('PIN ativado ✓ O app pede o PIN ao abrir.');
}
