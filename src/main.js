import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { db } from './db.js';
import { icon } from './icons.js';
import { actionSheet, confirmDialog, dialog, toast, fullPanel, closeTopOverlay, hasOverlay } from './ui.js';
import {
  esc, brl, money, setHidden, isHidden, today, ym, brDate, brShort, monthLabel, shiftMonth, dueLabel, addDays, daysBetween, r2, pct,
} from './fmt.js';
import { donut, bars, progress } from './charts.js';
import { txForm, payDialog, cardForm, debtForm, accountForm, categoryForm, goalForm, goalMoveForm, budgetForm, valeForm, VALES, excluirLancamento } from './forms.js';
import { analyze, chartAcumulado } from './analysis.js';
import { exportReport, saveFile } from './report.js';
import { configured, syncNow, scheduleSync, status as syncStatus, onStatus, testConnection, configCode, parseConfigCode, randomKey } from './sync.js';
import { native, initNative, afterChange, notifStatus, askNotif, testNotif, exactAlarmSettings } from './native.js';
import { setupLock, checkLock, lockNow, lockEnabled, lockLabel, showShade, onResume } from './lock.js';

const $app = document.getElementById('app');
const st = { tab: 'home', month: ym(today()), txFilter: 'all', txQ: '', dueSide: 'pagar', vale: 'vr' };

// ======================================================================
// Render
// ======================================================================
function applyTheme() {
  const t = db.s.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (native) SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

function render() {
  setHidden(!!db.s.hideValues);
  const keepY = window.scrollY;
  const v = { home: viewHome, txs: viewTxs, dues: viewDues, cards: viewCards, more: viewMore }[st.tab]();
  $app.innerHTML = `<div class="screen">${v}</div>
  <button class="fab" data-act="fab" aria-label="Novo lançamento">${icon('plus', 28)}</button>
  <nav class="bottom-nav">
    ${nav('home', 'home', 'Início')}${nav('txs', 'list', 'Lançamentos')}${nav('dues', 'bill', 'Contas', db.dues({ until: today() }).filter((d) => d.dir === 'out').length)}${nav('cards', 'card', 'Cartões')}${nav('more', 'more', 'Mais')}
  </nav>`;
  window.scrollTo(0, keepY);
}
const nav = (id, ic, label, badge = 0) => `<button class="nav-btn ${st.tab === id ? 'on' : ''}" data-tab="${id}">${icon(ic, 22)}${badge ? `<span class="badge">${badge}</span>` : ''}<span>${label}</span></button>`;

const monthBar = (k) => `<div class="month-bar"><button class="icon-btn" data-act="m-prev">${icon('back')}</button>
  <button class="month-lbl" data-act="m-today">${monthLabel(k)}</button>
  <button class="icon-btn flip" data-act="m-next">${icon('back')}</button></div>`;
const reportBtn = (key) => `<button class="icon-btn" data-report="${key}" aria-label="Relatório">${icon('pdf')}</button>`;
const eyeBtn = () => `<button class="icon-btn" data-act="eye" aria-label="Ocultar valores">${icon(isHidden() ? 'eyeoff' : 'eye')}</button>`;

function txRow(t) {
  const c = db.cat(t.catId);
  const isT = t.type === 'transfer';
  const ic = t.wallet && t.type === 'income' ? '💳' : isT ? '🔁' : t.kind === 'invoice' ? '💳' : t.kind === 'goal' ? (t.goalId ? '🎯' : '⚖️') : c?.icon || '❔';
  const color = isT ? '#64748b' : t.kind === 'invoice' ? '#7c3aed' : c?.color || '#94a3b8';
  const where = t.wallet ? `${VALES[t.wallet]?.icon || ''} ${VALES[t.wallet]?.nome || 'Vale'}` : t.cardId && t.kind !== 'invoice' ? `💳 ${db.card(t.cardId)?.name || ''}` : isT ? `${db.acc(t.accountId)?.name} → ${db.acc(t.toAccountId)?.name}` : db.acc(t.accountId)?.name || '';
  const title = t.desc || (isT ? 'Transferência' : c?.name || 'Lançamento');
  const sign = t.type === 'income' ? '+' : isT ? '' : '−';
  const pend = !t.paid && !t.cardId && !isT && !t.wallet;
  return `<button class="tx-row" data-tx="${t.id}">
    <span class="tx-ic" style="--c:${color}">${ic}</span>
    <span class="grow tx-main"><b>${esc(title)}</b>
      <span class="muted small">${esc([c && !isT && t.desc ? c.name : '', where, t.inst ? `${t.inst.n}/${t.inst.total}` : ''].filter(Boolean).join(' · '))}</span></span>
    <span class="tx-val ${t.type}">${sign} ${money(t.amount)}${pend ? `<span class="pend">${t.type === 'income' ? 'a receber' : 'pendente'}</span>` : ''}</span>
  </button>`;
}

function dueRow(d, withBtn = true) {
  const l = dueLabel(d.due);
  return `<div class="due-row">
    <button class="grow due-main" data-due="${esc(d.key)}"><span class="tx-ic">${d.icon}</span>
      <span class="grow tx-main"><b>${esc(d.title)}</b><span class="small ${l.c}">${l.t}${d.sub ? ` · <span class="muted">${esc(d.sub)}</span>` : ''}</span></span>
      <span class="tx-val ${d.dir === 'in' ? 'income' : 'expense'}">${money(d.amount)}</span></button>
    ${withBtn ? `<button class="btn sm ${d.dir === 'in' ? 'ok' : 'primary'}" data-pay="${esc(d.key)}">${d.dir === 'in' ? 'Receber' : 'Pagar'}</button>` : ''}
  </div>`;
}

// ---------------------------- Sincronização ---------------------------
function syncChip() {
  if (!configured()) return '';
  const st2 = syncStatus.state;
  const ic = st2 === 'syncing' ? '🔄' : st2 === 'error' ? '⚠️' : '☁️';
  const tip = st2 === 'error' ? 'Erro ao sincronizar' : st2 === 'syncing' ? 'Sincronizando' : 'Sincronizado';
  return `<button class="icon-btn sync-btn ${st2}" data-act="sync" title="${tip}" aria-label="${tip}">${ic}</button>`;
}
onStatus(() => {
  document.querySelectorAll('.sync-chip').forEach((el) => (el.innerHTML = syncChip()));
  document.querySelectorAll('[data-sync-status]').forEach((el) => (el.innerHTML = syncStatusText()));
});
function syncStatusText() {
  const c = db.s.sync || {};
  if (syncStatus.state === 'syncing') return '<span class="muted">🔄 Sincronizando...</span>';
  if (syncStatus.state === 'error') return `<span class="expense">⚠️ ${esc(syncStatus.error)}</span>`;
  const last = syncStatus.last || c.last;
  return last ? `<span class="income">✓ Sincronizado</span> <span class="muted small">às ${new Date(last).toLocaleTimeString('pt-BR').slice(0, 5)} de ${new Date(last).toLocaleDateString('pt-BR')}</span>` : '<span class="muted">Ainda não sincronizado</span>';
}

function connectPanel(onDone) {
  const p = fullPanel('form-panel connect-panel');
  const key = db.s.sync?.key || randomKey();
  p.el.innerHTML = `<div class="panel">
    <header class="panel-head"><button class="icon-btn" data-x>${icon('close')}</button><h2 class="grow">Conectar planilha</h2></header>
    <form class="panel-body form">
      <div class="info-box"><b>Já conectou em outro aparelho?</b><br><span class="small">Cole aqui o código que aparece lá (começa com <b>MF1:</b>). Ele já traz o link e a chave.</span>
        <textarea class="input" name="code" rows="2" placeholder="MF1:..."></textarea></div>
      <p class="center muted small">— ou preencha manualmente —</p>
      <label class="fld"><span>Link do App da Web (termina em /exec)</span><input class="input" name="url" value="${esc(db.s.sync?.url || '')}" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off"></label>
      <label class="fld"><span>Chave de sincronização</span><input class="input" name="key" value="${esc(key)}" autocomplete="off"></label>
      <p class="muted small">A chave protege seus dados. Na primeira conexão ela fica registrada na planilha. Use a mesma chave em todos os aparelhos (o código MF1 já leva ela).</p>
      <div class="connect-err expense small"></div>
      <button class="btn primary block big-btn" type="submit">Conectar</button>
    </form></div>`;
  p.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) p.close();
  });
  const form = p.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const err = p.el.querySelector('.connect-err');
    err.textContent = '';
    let url = f.url.trim(), k = f.key.trim();
    try {
      if (f.code.trim()) ({ url, key: k } = parseConfigCode(f.code));
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error('O link precisa ser do Google Apps Script (script.google.com/.../exec).');
      if (k.length < 8) throw new Error('A chave precisa ter pelo menos 8 caracteres.');
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Conectando...';
      try {
        const r = await testConnection(url, k);
        db.d.settings.sync = { url, key: k, enabled: true, sheet: r.sheet, sheetUrl: r.url };
        await db.save();
        p.close();
        toast(r.hasData ? 'Conectado! Baixando os dados da planilha...' : 'Conectado! Enviando seus dados para a planilha...');
        await syncNow();
        onDone?.();
      } finally {
        btn.disabled = false;
        btn.textContent = 'Conectar';
      }
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    dialog({ title: 'Copie o código', input: true, value: text, multiline: true, ok: 'Fechar', cancel: null });
  }
}

// ---------------------------- Início ----------------------------------
/** Receitas / Despesas / Resultado — tocar em Receitas ou Despesas abre a lista */
function kpisMes(m) {
  return `<div class="kpis">
    <button class="kpi tap" data-act="list-type" data-v="income"><small>Receitas ›</small><b class="income">${money(m.income)}</b></button>
    <button class="kpi tap" data-act="list-type" data-v="expense"><small>Despesas ›</small><b class="expense">${money(m.expense)}</b></button>
    <button class="kpi tap" data-act="analise"><small>Resultado ›</small><b class="${m.balance >= 0 ? 'income' : 'expense'}">${money(m.balance)}</b></button>
  </div>`;
}

function analiseMini() {
  const a = analyze(ym(today()));
  const al = a.alertas.find((x) => x.t === 'ruim') || a.alertas[0];
  return `<button class="card-box analise-mini" data-act="analise">
    <h3>📈 Análise do mês <span class="link small">ver tudo ›</span></h3>
    <div class="an-grid">
      <div><small class="muted">Pode gastar hoje</small><b class="${a.porDia < 0 ? 'expense' : 'income'}">${a.porDia < 0 ? money(0) : money(a.porDia)}</b><small class="muted">por dia até o fim do mês</small></div>
      <div><small class="muted">Despesas previstas</small><b>${money(a.projecaoDespesas)}</b><small class="muted">média ${money(a.mediaDia)}/dia</small></div>
      <div><small class="muted">Fim do mês</small><b class="${a.projecaoResultado >= 0 ? 'income' : 'expense'}">${money(a.projecaoResultado)}</b><small class="muted">${a.projecaoResultado >= 0 ? 'sobra prevista' : 'falta prevista'}</small></div>
    </div>
    ${al ? `<p class="an-alert ${al.t}">${al.t === 'ruim' ? '⚠️' : al.t === 'bom' ? '✅' : '💡'} ${esc(al.m)}</p>` : ''}
  </button>`;
}

function valeMini() {
  if (!db.hasVale()) return '';
  const ws = ['vr', 'va'].filter((w) => db.valeTxs(w).length);
  return `<button class="card-box vale-mini" data-act="open" data-v="vale">
    <h3>Vale refeição / alimentação <span class="link small">abrir ›</span></h3>
    <div class="row wrap">${ws.map((w) => `<span class="vale-chip">${VALES[w].icon} ${VALES[w].nome} <b>${money(db.valeBalance(w))}</b></span>`).join('')}</div>
  </button>`;
}

function viewHome() {
  const k = st.month;
  const m = db.monthStats(k);
  const total = db.totalBalance();
  const late = db.dues({ until: addDays(today(), -1) });
  const soon = db.dues({ from: today(), until: addDays(today(), 7) });
  const byCat = db.byCategory(m.list);
  const budgets = db.budgetStatus(k).slice(0, 3);
  const h = new Date().getHours();
  return `
  <header class="top"><div><div class="muted small">${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'} 👋</div><h1>Minhas Finanças</h1></div>
    <div class="row"><span class="sync-chip">${syncChip()}</span>${eyeBtn()}${reportBtn('home')}</div></header>
  <div class="hero-card">
    <span class="small">Saldo atual</span>
    <b class="hero-val">${money(total)}</b>
    <span class="small">Previsto para o fim de ${monthLabel(ym(today())).split(' ')[0].toLowerCase()}: <b>${money(db.forecast(ym(today())))}</b></span>
    <div class="acc-chips">${db.accounts().map((a) => `<span>${a.icon || '🏦'} ${esc(a.name)} <b>${money(db.accountBalance(a.id))}</b></span>`).join('')}</div>
  </div>
  ${late.length ? `<button class="alert" data-act="go-dues">⚠️ <span class="grow"><b>${late.length} conta${late.length > 1 ? 's' : ''} vencida${late.length > 1 ? 's' : ''}</b> · ${money(late.reduce((s, x) => s + x.amount, 0))}</span>${icon('back', 18, 'flip')}</button>` : ''}
  ${monthBar(k)}
  ${kpisMes(m)}
  ${analiseMini()}
  ${valeMini()}
  <section class="card-box"><h3>Próximos vencimentos <button class="link small" data-act="go-dues">ver tudo</button></h3>
    ${soon.length ? soon.slice(0, 5).map((d) => dueRow(d)).join('') : '<p class="muted small">Nada vencendo nos próximos 7 dias. 🎉</p>'}</section>
  <section class="card-box"><h3>Despesas por categoria</h3>${donut(byCat, m.expense, { center: money(m.expense) })}</section>
  ${budgets.length ? `<section class="card-box"><h3>Orçamentos <button class="link small" data-act="open" data-v="budgets">ver tudo</button></h3>
    ${budgets.map((b) => `<div class="bud"><div class="row"><span class="grow">${b.cat.icon} ${esc(b.cat.name)}</span><span class="small ${b.pct > 1 ? 'expense' : 'muted'}">${money(b.spent)} de ${money(b.limit)}</span></div>${progress(b.pct, b.pct > 1 ? '#ef4444' : b.pct > 0.8 ? '#f59e0b' : '')}</div>`).join('')}</section>` : ''}
  <section class="card-box"><h3>Últimos 6 meses</h3>${bars(db.lastMonths(6))}</section>
  ${db.d.cards.length ? `<section class="card-box"><h3>Cartões</h3>${db.d.cards.filter((c) => !c.archived).map((c) => {
      const inv = db.invoice(c.id, db.currentInvoiceKey(c));
      return `<button class="mini-card" data-card="${c.id}"><span class="cc-dot" style="background:${c.color}"></span><span class="grow"><b>${esc(c.name)}</b><span class="muted small">Fatura atual · vence ${brShort(inv.due)}</span></span><b>${money(inv.total)}</b></button>`;
    }).join('')}</section>` : ''}`;
}

// ---------------------------- Lançamentos ------------------------------
function txList() {
  const q = st.txQ.trim().toLowerCase();
  return db.monthTxs(st.month)
    .filter((t) => {
      if (st.txFilter === 'income' && t.type !== 'income') return false;
      if (st.txFilter === 'expense' && t.type !== 'expense') return false;
      if (st.txFilter === 'pending' && (t.paid || t.cardId || t.type === 'transfer')) return false;
      if (st.txFilter === 'card' && !(t.cardId && t.kind !== 'invoice')) return false;
      if (q && !`${t.desc} ${db.cat(t.catId)?.name || ''} ${t.notes || ''}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}
function viewTxs() {
  const list = txList();
  const m = db.monthStats(st.month);
  let last = '';
  const rows = list.map((t) => {
    const head = t.date !== last ? `<div class="day-head">${brDate(t.date)} · ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(t.date + 'T12:00').getDay()]}</div>` : '';
    last = t.date;
    return head + txRow(t);
  }).join('');
  const chip = (v, l) => `<button class="chip ${st.txFilter === v ? 'on' : ''}" data-txf="${v}">${l}</button>`;
  return `
  <header class="top"><h1>Lançamentos</h1><div class="row">${eyeBtn()}${reportBtn('txs')}</div></header>
  ${monthBar(st.month)}
  ${kpisMes(m)}
  <div class="chips">${chip('all', 'Todos')}${chip('expense', 'Despesas')}${chip('income', 'Receitas')}${chip('pending', 'Pendentes')}${chip('card', 'Cartão')}</div>
  <input class="input search" id="txq" placeholder="Buscar..." value="${esc(st.txQ)}">
  <div class="tx-list">${rows || `<div class="empty">${icon('list', 40)}<p>Nenhum lançamento neste mês.</p><button class="btn primary" data-act="fab">Adicionar</button></div>`}</div>`;
}

// ---------------------------- Contas a pagar/receber -------------------
function viewDues() {
  const dir = st.dueSide === 'pagar' ? 'out' : 'in';
  const all = db.dues().filter((d) => d.dir === dir);
  const t = today();
  const groups = [
    ['Vencidas', (d) => d.due < t, 'late'],
    ['Hoje', (d) => d.due === t],
    ['Próximos 7 dias', (d) => d.due > t && d.due <= addDays(t, 7)],
    ['Este mês', (d) => d.due > addDays(t, 7) && ym(d.due) === ym(t)],
    ['Próximo mês', (d) => d.due > addDays(t, 7) && ym(d.due) === shiftMonth(ym(t), 1)],
    ['Mais adiante', (d) => ym(d.due) > shiftMonth(ym(t), 1)],
  ];
  const used = new Set();
  const total30 = all.filter((d) => d.due <= addDays(t, 30)).reduce((s, d) => s + d.amount, 0);
  const lateTot = all.filter((d) => d.due < t).reduce((s, d) => s + d.amount, 0);
  const secs = groups.map(([name, fn, cls]) => {
    const items = all.filter((d) => !used.has(d.key) && fn(d));
    items.forEach((d) => used.add(d.key));
    if (!items.length) return '';
    const shown = name === 'Mais adiante' ? items.slice(0, 30) : items;
    return `<h2 class="section ${cls || ''}">${name} <span class="muted">${money(items.reduce((s, d) => s + d.amount, 0))}</span></h2>
      <div class="card-box flush">${shown.map((d) => dueRow(d)).join('')}</div>${shown.length < items.length ? `<p class="muted small center">+${items.length - shown.length} itens</p>` : ''}`;
  }).join('');
  return `
  <header class="top"><h1>Contas</h1><div class="row">${eyeBtn()}${reportBtn('dues')}</div></header>
  <div class="seg full two-seg"><button class="${st.dueSide === 'pagar' ? 'on' : ''}" data-side="pagar">A pagar</button><button class="${st.dueSide === 'receber' ? 'on' : ''}" data-side="receber">A receber</button></div>
  <div class="kpis two"><div class="kpi"><small>${dir === 'out' ? 'Vencido' : 'Atrasado'}</small><b class="${lateTot ? 'expense' : ''}">${money(lateTot)}</b></div>
    <div class="kpi"><small>Próximos 30 dias</small><b>${money(total30)}</b></div></div>
  <button class="btn ghost block" data-act="new-bill">${icon('plus', 18)} ${dir === 'out' ? 'Cadastrar conta / boleto' : 'Cadastrar valor a receber'}</button>
  ${secs || `<div class="empty">${icon('bill', 40)}<p>Nenhuma conta ${dir === 'out' ? 'a pagar' : 'a receber'}.</p></div>`}`;
}

// ---------------------------- Cartões ----------------------------------
function cardVisual(c) {
  const used = db.cardUsed(c.id);
  const inv = db.invoice(c.id, db.currentInvoiceKey(c));
  const avail = r2((c.limit || 0) - used);
  return `<button class="cc" data-card="${c.id}" style="--cc:${c.color}">
    <div class="row"><b class="cc-name">${esc(c.name)}</b><span class="grow"></span>${icon('card', 22)}</div>
    <div class="cc-inv"><span class="small">Fatura atual (${inv.status})</span><b>${money(inv.total)}</b><span class="small">fecha ${brShort(inv.close)} · vence ${brShort(inv.due)}</span></div>
    ${c.limit ? `${progress(used / c.limit, '#fff')}<div class="row small"><span class="grow">Disponível ${money(avail)}</span><span>Limite ${money(c.limit)}</span></div>` : ''}
  </button>`;
}
function viewCards() {
  const cards = db.d.cards.filter((c) => !c.archived);
  return `<header class="top"><h1>Cartões</h1><div class="row">${eyeBtn()}${cards.length ? reportBtn('cards') : ''}</div></header>
  ${cards.map(cardVisual).join('')}
  <button class="btn ghost block" data-act="new-card">${icon('plus', 18)} Adicionar cartão</button>
  ${cards.length ? `<button class="btn primary block" data-act="card-buy">${icon('card', 18)} Lançar compra no cartão</button>` : ''}`;
}

function openCard(cardId, key) {
  const { el, close } = fullPanel('card-detail', () => unsub());
  let k = key || db.currentInvoiceKey(db.card(cardId));
  const draw = () => {
    const c = db.card(cardId);
    if (!c) return close();
    const keys = db.invoiceKeys(cardId);
    const inv = db.invoice(cardId, k);
    const i = keys.indexOf(k);
    el.innerHTML = `<div class="panel">
      <header class="panel-head" style="background:${c.color};color:#fff"><button class="icon-btn" data-x>${icon('back')}</button><h2 class="grow">${esc(c.name)}</h2>
        <button class="icon-btn" data-c="report">${icon('pdf')}</button><button class="icon-btn" data-c="edit">${icon('edit')}</button></header>
      <div class="panel-body">
        <div class="month-bar"><button class="icon-btn" data-c="prev" ${i <= 0 ? 'disabled' : ''}>${icon('back')}</button>
          <span class="month-lbl">Fatura de ${monthLabel(k)}</span>
          <button class="icon-btn flip" data-c="next" ${i >= keys.length - 1 ? 'disabled' : ''}>${icon('back')}</button></div>
        <div class="inv-box st-${inv.status}"><span class="tag">${inv.status.toUpperCase()}</span><b>${money(inv.total)}</b>
          <span class="small">Fecha em ${brDate(inv.close)} · Vence em ${brDate(inv.due)}</span>
          ${inv.pay ? `<span class="small">Paga em ${brDate(inv.pay.date)} (${money(inv.pay.amount)}) com ${esc(db.acc(inv.pay.accountId)?.name || '')}</span>
            <button class="btn sm ghost" data-c="unpay">Desfazer pagamento</button>`
          : inv.total > 0 ? `<button class="btn primary" data-c="pay">Pagar fatura</button>` : ''}
        </div>
        <button class="btn ghost block" data-c="buy">${icon('plus', 18)} Nova compra neste cartão</button>
        <h2 class="section">Compras (${inv.items.length})</h2>
        <div class="card-box flush">${inv.items.map(txRow).join('') || '<p class="muted small center pad">Nenhuma compra nesta fatura.</p>'}</div>
      </div></div>`;
  };
  const unsub = db.on(draw);
  draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const tx = e.target.closest('[data-tx]');
    if (tx) return txDetail(tx.dataset.tx);
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const keys = db.invoiceKeys(cardId);
    const c = db.card(cardId);
    switch (b.dataset.c) {
      case 'prev': k = keys[keys.indexOf(k) - 1] || k; draw(); break;
      case 'next': k = keys[keys.indexOf(k) + 1] || k; draw(); break;
      case 'pay': {
        const inv = db.invoice(cardId, k);
        payDialog({ kind: 'fatura', ref: cardId, inv: k, title: `Fatura ${c.name}`, amount: inv.total, due: inv.due, dir: 'out', icon: '💳' });
        break;
      }
      case 'unpay': if (await confirmDialog('Desfazer pagamento?', 'O valor volta para a conta.', 'Desfazer', false)) db.unpayInvoice(cardId, k); break;
      case 'buy': txForm({ type: 'expense', card: true, cardId }); break;
      case 'edit': cardForm(cardId); break;
      case 'report': chooseFormat(() => specCard(cardId, k)); break;
    }
  });
}

// ---------------------------- Mais ------------------------------------
function viewMore() {
  const debts = db.d.debts.filter((x) => x.kind !== 'financiamento');
  const fins = db.d.debts.filter((x) => x.kind === 'financiamento');
  const item = (v, ic, label, sub) => `<button class="menu-item" data-act="open" data-v="${v}"><span class="menu-ic">${ic}</span><span class="grow"><b>${label}</b><span class="muted small">${sub}</span></span>${icon('back', 18, 'flip')}</button>`;
  const owe = debts.filter((x) => x.kind === 'peguei').reduce((s, x) => s + db.debtSummary(x).remaining, 0);
  return `<header class="top"><h1>Mais</h1>${eyeBtn()}</header>
  <div class="menu">
    ${item('analise', '📈', 'Análise do mês', 'Previsão, quanto gastar por dia e alertas')}
    ${item('vale', '🍽️', 'Vale Refeição / Alimentação', db.hasVale() ? ['vr', 'va'].filter((w) => db.valeTxs(w).length).map((w) => `${VALES[w].nome.replace('Vale ', '')}: ${money(db.valeBalance(w))}`).join(' · ') : 'Saldo do mês e gastos do vale')}
    ${item('loans', '🤝', 'Empréstimos', debts.length ? `${debts.length} cadastrado(s) · devo ${money(owe)}` : 'O que você deve ou emprestou')}
    ${item('fin', '🏦', 'Financiamentos', fins.length ? `${fins.length} ativo(s)` : 'Carro, imóvel, parcelas e juros')}
    ${item('budgets', '📊', 'Orçamentos', 'Limite de gastos por categoria')}
    ${item('goals', '🎯', 'Metas', db.d.goals.length ? `${db.d.goals.length} meta(s)` : 'Juntar dinheiro para um objetivo')}
    ${item('accounts', '🏦', 'Contas e carteiras', `Saldo total ${money(db.totalBalance())}`)}
    ${item('categories', '🏷️', 'Categorias', 'Personalizar ícones e nomes')}
    ${item('reports', '📄', 'Relatórios', 'PDF e Excel de cada área')}
    ${item('settings', '⚙️', 'Ajustes', 'Notificações, PIN, tema, backup')}
  </div>`;
}

// ======================================================================
// Painéis de "Mais"
// ======================================================================
function simplePanel(cls, title, bodyFn, { headBtns = '', onClick } = {}) {
  const { el, close } = fullPanel(cls, () => unsub());
  const draw = () => {
    const sc = el.querySelector('.panel-body')?.scrollTop || 0;
    el.innerHTML = `<div class="panel"><header class="panel-head"><button class="icon-btn" data-x>${icon('back')}</button><h2 class="grow">${title}</h2>${headBtns}</header>
      <div class="panel-body">${bodyFn()}</div></div>`;
    el.querySelector('.panel-body').scrollTop = sc;
  };
  const unsub = db.on(draw);
  draw();
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return close();
    onClick?.(e, draw, close);
  });
  return { el, close, draw };
}

function openDebts(fin) {
  const kindLabel = { peguei: 'Devo', emprestei: 'Me devem', financiamento: 'Financiamento' };
  simplePanel('debts', fin ? 'Financiamentos' : 'Empréstimos', () => {
    const list = db.d.debts.filter((x) => (fin ? x.kind === 'financiamento' : x.kind !== 'financiamento'));
    const card = (x) => {
      const s = db.debtSummary(x);
      return `<button class="debt-card" data-debt="${x.id}">
        <div class="row"><span class="big-emoji">${fin ? '🏦' : x.kind === 'emprestei' ? '🫴' : '🤝'}</span><span class="grow"><b>${esc(x.name)}</b><span class="muted small">${kindLabel[x.kind]} · ${s.paidCount}/${x.schedule.length} parcelas</span></span>
          <span class="right"><b>${money(s.remaining)}</b><span class="muted small">restante</span></span></div>
        ${progress(s.progress)}
        <div class="row small muted"><span class="grow">${s.next ? `Próxima: ${money(s.next.amount)} em ${brDate(s.next.due)}` : '✅ Quitado'}</span><span>${Math.round(s.progress * 100)}%</span></div></button>`;
    };
    if (!list.length) return `<div class="empty">${fin ? '🏦' : '🤝'}<p>${fin ? 'Cadastre seu financiamento para acompanhar parcelas, juros e saldo devedor.' : 'Cadastre o que você pegou emprestado ou emprestou para alguém.'}</p></div><button class="btn primary block" data-new>${icon('plus', 18)} Cadastrar</button>`;
    const totalRem = list.filter((x) => x.kind !== 'emprestei').reduce((s, x) => s + db.debtSummary(x).remaining, 0);
    const totalRec = list.filter((x) => x.kind === 'emprestei').reduce((s, x) => s + db.debtSummary(x).remaining, 0);
    return `<div class="kpis two"><div class="kpi"><small>${fin ? 'Falta pagar' : 'Eu devo'}</small><b class="expense">${money(totalRem)}</b></div>
      ${fin ? `<div class="kpi"><small>Parcelas no mês</small><b>${money(list.reduce((s, x) => s + x.schedule.filter((p) => ym(p.due) === ym(today())).reduce((a, p) => a + p.amount, 0), 0))}</b></div>` : `<div class="kpi"><small>Me devem</small><b class="income">${money(totalRec)}</b></div>`}</div>
      ${list.map(card).join('')}<button class="btn primary block" data-new>${icon('plus', 18)} Cadastrar</button>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: (e) => {
      if (e.target.closest('[data-new]')) debtForm(fin ? 'financiamento' : 'emprestimo');
      if (e.target.closest('[data-rep]')) chooseFormat(() => specDebts(fin));
      const d = e.target.closest('[data-debt]');
      if (d) openDebt(d.dataset.debt);
    },
  });
}

function openDebt(id) {
  simplePanel('debt-detail', 'Detalhes', () => {
    const x = db.debt(id);
    if (!x) return '';
    const s = db.debtSummary(x);
    const lent = x.kind === 'emprestei';
    return `<div class="hero-card soft"><b class="hero-sub">${esc(x.name)}</b><span class="small">${lent ? 'A receber' : 'Falta pagar'}</span><b class="hero-val">${money(s.remaining)}</b>
        ${progress(s.progress, '#fff')}<span class="small">${s.paidCount} de ${x.schedule.length} parcelas ${lent ? 'recebidas' : 'pagas'} · ${money(s.paidValue)}</span></div>
      <div class="kpis two">
        <div class="kpi"><small>${x.kind === 'financiamento' ? 'Valor financiado' : 'Valor'}</small><b>${money(x.principal)}</b></div>
        <div class="kpi"><small>Total com juros</small><b>${money(s.total)}</b></div>
        <div class="kpi"><small>Juros totais</small><b class="expense">${money(s.interest)}</b></div>
        <div class="kpi"><small>Taxa</small><b>${Number(x.rateCalc ?? x.rate ?? 0).toFixed(2).replace('.', ',')}% a.m.</b></div>
        ${x.kind === 'financiamento' && x.assetValue ? `<div class="kpi"><small>Valor do bem</small><b>${money(x.assetValue)}</b></div><div class="kpi"><small>Entrada</small><b>${money(x.downPayment || 0)}</b></div>` : ''}
        <div class="kpi"><small>Saldo devedor</small><b>${money(s.balance)}</b></div>
        <div class="kpi"><small>Sistema</small><b class="sm-b">${{ fixa: 'Parcela fixa', price: 'Price', sac: 'SAC', sem: 'Sem juros' }[x.system]}</b></div>
      </div>
      <h2 class="section">Parcelas</h2>
      <div class="sched">${x.schedule.map((p) => {
        const l = dueLabel(p.due);
        return `<div class="sch-row ${p.paid ? 'paid' : ''}"><span class="sch-n">${p.n}</span>
          <span class="grow"><b>${money(p.paidAmount ?? p.amount)}</b><span class="small ${p.paid ? 'muted' : l.c}">${p.paid ? `${lent ? 'Recebida' : 'Paga'} em ${brDate(p.paidDate)}${p.pre ? ' (antes do app)' : ''}` : `Vence ${brDate(p.due)}`}</span>
          ${x.system !== 'sem' && x.system ? `<span class="muted tiny">juros ${money(p.interest)} · amort. ${money(p.amort)} · saldo ${money(p.balance)}</span>` : ''}</span>
          ${p.paid ? `<button class="btn sm ghost" data-unpay="${p.n}">Desfazer</button>` : `<button class="btn sm ${lent ? 'ok' : 'primary'}" data-payn="${p.n}">${lent ? 'Receber' : 'Pagar'}</button>`}</div>`;
      }).join('')}</div>
      ${x.notes ? `<p class="muted small">📝 ${esc(x.notes)}</p>` : ''}`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button><button class="icon-btn" data-edit>${icon('edit')}</button>`,
    onClick: async (e) => {
      const x = db.debt(id);
      if (e.target.closest('[data-edit]')) debtForm(x.kind, id);
      if (e.target.closest('[data-rep]')) chooseFormat(() => specDebts(x.kind === 'financiamento', id));
      const pn = e.target.closest('[data-payn]');
      if (pn) {
        const p = x.schedule.find((q) => q.n === +pn.dataset.payn);
        payDialog({ kind: 'parcela', ref: id, n: p.n, title: `${x.name} (${p.n}/${x.schedule.length})`, amount: p.amount, due: p.due, dir: x.kind === 'emprestei' ? 'in' : 'out', icon: x.kind === 'financiamento' ? '🏦' : '🤝' });
      }
      const un = e.target.closest('[data-unpay]');
      if (un && (await confirmDialog('Desfazer pagamento da parcela?', 'O lançamento correspondente será apagado.', 'Desfazer', false))) db.unpayInstallment(id, +un.dataset.unpay);
    },
  });
}

function openBudgets() {
  let k = st.month;
  simplePanel('budgets', 'Orçamentos', () => {
    const list = db.budgetStatus(k);
    const totL = list.reduce((s, b) => s + b.limit, 0), totS = list.reduce((s, b) => s + b.spent, 0);
    return `${monthBar(k)}
      ${list.length ? `<div class="kpis two"><div class="kpi"><small>Orçado</small><b>${money(totL)}</b></div><div class="kpi"><small>Gasto</small><b class="${totS > totL ? 'expense' : ''}">${money(totS)}</b></div></div>` : ''}
      ${list.map((b) => `<button class="bud card-box" data-bud="${b.id}"><div class="row"><span class="tx-ic" style="--c:${b.cat.color}">${b.cat.icon}</span><span class="grow"><b>${esc(b.cat.name)}</b>
        <span class="small ${b.pct > 1 ? 'expense' : 'muted'}">${b.pct > 1 ? `Passou ${money(b.spent - b.limit)}` : `Restam ${money(b.limit - b.spent)}`}</span></span>
        <span class="right"><b>${money(b.spent)}</b><span class="muted small">de ${money(b.limit)}</span></span></div>
        ${progress(b.pct, b.pct > 1 ? '#ef4444' : b.pct > 0.8 ? '#f59e0b' : '')}</button>`).join('') || `<div class="empty">📊<p>Defina quanto quer gastar por mês em cada categoria. O app avisa quando estiver perto do limite.</p></div>`}
      <button class="btn primary block" data-new>${icon('plus', 18)} Definir orçamento</button>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: (e, draw) => {
      if (e.target.closest('[data-new]')) budgetForm();
      const b = e.target.closest('[data-bud]');
      if (b) budgetForm(b.dataset.bud);
      if (e.target.closest('[data-act="m-prev"]')) { k = shiftMonth(k, -1); draw(); }
      if (e.target.closest('[data-act="m-next"]')) { k = shiftMonth(k, 1); draw(); }
      if (e.target.closest('[data-act="m-today"]')) { k = ym(today()); draw(); }
      if (e.target.closest('[data-rep]')) chooseFormat(() => specBudgets(k));
    },
  });
}

function openGoals() {
  simplePanel('goals', 'Metas', () => {
    const list = db.d.goals;
    return `${list.map((g) => {
      const saved = db.goalSaved(g), p = saved / g.target;
      const months = g.deadline ? Math.max(1, Math.ceil(daysBetween(today(), g.deadline) / 30)) : null;
      return `<button class="card-box goal" data-goal="${g.id}"><div class="row"><span class="big-emoji">${g.icon}</span><span class="grow"><b>${esc(g.name)}</b>
        <span class="muted small">${money(saved)} de ${money(g.target)}${g.deadline ? ` · até ${brDate(g.deadline)}` : ''}</span></span><b>${Math.round(p * 100)}%</b></div>
        ${progress(p, p >= 1 ? '#22c55e' : '')}
        ${p < 1 && months ? `<span class="muted small">Guardando ${money((g.target - saved) / months)} por mês você chega lá.</span>` : p >= 1 ? '<span class="small income">🎉 Meta atingida!</span>' : ''}</button>`;
    }).join('') || `<div class="empty">🎯<p>Crie metas para juntar dinheiro: viagem, reserva de emergência, celular novo...</p></div>`}
    <button class="btn primary block" data-new>${icon('plus', 18)} Nova meta</button>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: (e) => {
      if (e.target.closest('[data-new]')) goalForm();
      if (e.target.closest('[data-rep]')) chooseFormat(() => specGoals());
      const g = e.target.closest('[data-goal]');
      if (g) openGoal(g.dataset.goal);
    },
  });
}

function openGoal(id) {
  simplePanel('goal-detail', 'Meta', () => {
    const g = db.goal(id);
    if (!g) return '';
    const saved = db.goalSaved(g);
    return `<div class="hero-card soft"><span class="big-emoji">${g.icon}</span><b class="hero-sub">${esc(g.name)}</b><b class="hero-val">${money(saved)}</b>
      ${progress(saved / g.target, '#fff')}<span class="small">de ${money(g.target)} · faltam ${money(Math.max(0, g.target - saved))}</span></div>
      <div class="grid2"><button class="btn primary" data-in>${icon('down', 18)} Guardar</button><button class="btn ghost" data-out>${icon('up', 18)} Retirar</button></div>
      <h2 class="section">Movimentações</h2>
      <div class="card-box flush">${g.moves.slice().reverse().map((m) => `<div class="tx-row"><span class="tx-ic">${m.amount >= 0 ? '⬇️' : '⬆️'}</span>
        <span class="grow tx-main"><b>${m.amount >= 0 ? 'Guardado' : 'Retirado'}</b><span class="muted small">${brDate(m.date)}${m.note ? ' · ' + esc(m.note) : ''}</span></span>
        <span class="tx-val ${m.amount >= 0 ? 'income' : 'expense'}">${money(Math.abs(m.amount))}</span><button class="icon-btn sm" data-delm="${m.id}">${icon('trash', 16)}</button></div>`).join('') || '<p class="muted small center pad">Nenhuma movimentação.</p>'}</div>`;
  }, {
    headBtns: `<button class="icon-btn" data-edit>${icon('edit')}</button>`,
    onClick: async (e) => {
      if (e.target.closest('[data-edit]')) goalForm(id);
      if (e.target.closest('[data-in]')) goalMoveForm(id);
      if (e.target.closest('[data-out]')) goalMoveForm(id, true);
      const d = e.target.closest('[data-delm]');
      if (d && (await confirmDialog('Apagar movimentação?', '', 'Apagar'))) db.goalDeleteMove(id, d.dataset.delm);
    },
  });
}

function openAccounts() {
  simplePanel('accounts', 'Contas e carteiras', () => `
    <div class="hero-card"><span class="small">Saldo total</span><b class="hero-val">${money(db.totalBalance())}</b></div>
    <div class="card-box flush">${db.accounts().map((a) => `<button class="tx-row" data-acc="${a.id}"><span class="tx-ic">${a.icon || '🏦'}</span><span class="grow tx-main"><b>${esc(a.name)}</b>
      <span class="muted small">${a.excludeTotal ? 'fora do total' : ''}</span></span><b class="${db.accountBalance(a.id) < 0 ? 'expense' : ''}">${money(db.accountBalance(a.id))}</b></button>`).join('')}</div>
    <div class="grid2"><button class="btn primary" data-new>${icon('plus', 18)} Nova conta</button><button class="btn ghost" data-transfer>${icon('swap', 18)} Transferir</button></div>
    <button class="btn ghost block" data-adjust>Ajustar saldo de uma conta</button>`, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: async (e) => {
      if (e.target.closest('[data-new]')) accountForm();
      const a = e.target.closest('[data-acc]');
      if (a) accountForm(a.dataset.acc);
      if (e.target.closest('[data-transfer]')) txForm({ type: 'transfer' });
      if (e.target.closest('[data-rep]')) chooseFormat(() => specAccounts());
      if (e.target.closest('[data-adjust]')) {
        const id = await actionSheet({ title: 'Qual conta?', items: db.accounts().map((x) => ({ label: `${x.name} (${brl(db.accountBalance(x.id))})`, value: x.id })) });
        if (!id) return;
        const v = await dialog({ title: 'Saldo real da conta', message: 'Digite o saldo que aparece no banco. O app cria um lançamento de ajuste.', input: true, type: 'text', placeholder: '0,00', ok: 'Ajustar' });
        if (v == null) return;
        const neg = v.trim().startsWith('-');
        const real = (neg ? -1 : 1) * Math.abs((await import('./fmt.js')).parseMoney(v));
        const diff = r2(real - db.accountBalance(id));
        if (!diff) return toast('Saldo já está certo');
        db.addTx({ type: diff > 0 ? 'income' : 'expense', kind: 'goal', amount: Math.abs(diff), date: today(), paid: true, accountId: id, desc: 'Ajuste de saldo', catId: null });
        toast('Saldo ajustado');
      }
    },
  });
}

function openCategories() {
  let type = 'expense';
  simplePanel('cats', 'Categorias', () => `
    <div class="seg full two-seg"><button class="${type === 'expense' ? 'on' : ''}" data-t="expense">Despesas</button><button class="${type === 'income' ? 'on' : ''}" data-t="income">Receitas</button></div>
    <div class="card-box flush">${db.cats(type).map((c) => `<button class="tx-row" data-cat="${c.id}"><span class="tx-ic" style="--c:${c.color}">${c.icon}</span><span class="grow tx-main"><b>${esc(c.name)}</b></span>${icon('edit', 16)}</button>`).join('')}</div>
    <button class="btn primary block" data-new>${icon('plus', 18)} Nova categoria</button>`, {
    onClick: (e, draw) => {
      const t = e.target.closest('[data-t]');
      if (t) { type = t.dataset.t; draw(); }
      if (e.target.closest('[data-new]')) categoryForm(type);
      const c = e.target.closest('[data-cat]');
      if (c) categoryForm(type, c.dataset.cat);
    },
  });
}

function openReports() {
  const items = [
    ['home', '📊', 'Resumo do mês', `Receitas, despesas, categorias e saldos de ${monthLabel(st.month)}`],
    ['txs', '📋', 'Lançamentos do mês', `Extrato completo de ${monthLabel(st.month)}`],
    ['year', '📅', 'Resumo do ano', `Mês a mês de ${st.month.slice(0, 4)}`],
    ['dues', '🧾', 'Contas a pagar e receber', 'Vencidas e próximas'],
    ['cards', '💳', 'Cartões de crédito', 'Faturas e compras'],
    ['loans', '🤝', 'Empréstimos', 'Parcelas e saldos'],
    ['fin', '🏦', 'Financiamentos', 'Tabela de amortização'],
    ['budgets', '📈', 'Orçamentos', `Planejado x gasto em ${monthLabel(st.month)}`],
    ['goals', '🎯', 'Metas', 'Progresso e movimentações'],
    ['accounts', '🏦', 'Contas e saldos', 'Saldo de cada conta'],
    ['analise', '📈', 'Análise do mês', `Previsão e indicadores de ${monthLabel(st.month)}`],
    ['vale', '🍽️', 'Vale refeição / alimentação', `Créditos e gastos de ${monthLabel(st.month)}`],
  ];
  simplePanel('reports', 'Relatórios', () => `<p class="muted small">Escolha o relatório e o formato. O arquivo é salvo em <b>Documentos/MinhasFinancas</b> e você pode enviar por WhatsApp, e-mail ou Drive.</p>
    <p class="muted small">Mês selecionado: <b>${monthLabel(st.month)}</b> (mude na aba Início ou Lançamentos).</p>
    <div class="menu">${items.map(([k, ic, l, s]) => `<button class="menu-item" data-r="${k}"><span class="menu-ic">${ic}</span><span class="grow"><b>${l}</b><span class="muted small">${s}</span></span>${icon('pdf', 18)}</button>`).join('')}</div>`, {
    onClick: (e) => {
      const r = e.target.closest('[data-r]');
      if (r) openReport(r.dataset.r);
    },
  });
}

async function openSettings() {
  const P = await notifStatus();
  simplePanel('settings', 'Ajustes', () => {
    const s = db.s;
    const sc = s.sync || {};
    return `
    <h2 class="section">Sincronização (Google Planilhas)</h2>
    ${configured() ? `
      <div class="set-row"><span class="grow" data-sync-status>${syncStatusText()}</span></div>
      ${sc.sheet ? `<div class="set-row small"><span class="grow muted">Planilha: <b>${esc(sc.sheet)}</b></span>${sc.sheetUrl ? `<a class="link small" href="${esc(sc.sheetUrl)}" target="_blank" rel="noopener">abrir</a>` : ''}</div>` : ''}
      <button class="set-btn" data-s="sync-now">🔄 Sincronizar agora</button>
      <button class="set-btn" data-s="sync-code">📋 Copiar código para outro aparelho</button>
      <button class="set-btn danger" data-s="sync-off">Desconectar deste aparelho</button>`
    : `<p class="muted small">Conecte uma planilha do Google para usar o app no celular e no computador ao mesmo tempo, com os mesmos dados. É grátis.</p>
      <button class="set-btn" data-s="sync-connect">☁️ Conectar planilha do Google</button>`}

    <h2 class="section">Notificações de vencimento</h2>
    <div class="set-row"><span class="grow">Status</span><b class="${P.ok ? 'income' : 'expense'}">${P.label}</b></div>
    <div class="set-row"><span class="grow">Avisar</span><select class="input auto" data-set="reminderDays">${[[0, 'só no dia'], [1, '1 dia antes e no dia'], [2, '2 dias antes e no dia'], [3, '3 dias antes e no dia'], [5, '5 dias antes e no dia']].map(([v, l]) => `<option value="${v}" ${+s.reminderDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="set-row"><span class="grow">Horário do aviso</span><select class="input auto" data-set="reminderHour">${[7, 8, 9, 10, 12, 14, 18, 20].map((h) => `<option value="${h}" ${+s.reminderHour === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></div>
    <button class="set-btn" data-s="notif">${icon('bell', 18)} Permitir notificações</button>
    <button class="set-btn" data-s="exact">${icon('clock', 18)} Alarmes no horário exato</button>
    <button class="set-btn" data-s="test">${icon('bell', 18)} Enviar notificação de teste</button>

    <h2 class="section">Privacidade</h2>
    <label class="switch-row"><span>Ocultar valores ao abrir</span><input type="checkbox" data-set="hideValues" ${s.hideValues ? 'checked' : ''}></label>
    <label class="switch-row"><span>Ocultar valores nos widgets</span><input type="checkbox" data-set="widgetHide" ${s.widgetHide ? 'checked' : ''}></label>

    <h2 class="section">Bloqueio do app</h2>
    <div class="set-row"><span class="grow">Desbloquear com</span><b class="${lockEnabled() ? 'income' : 'muted'}">${lockLabel()}</b></div>
    <button class="set-btn" data-s="pin">${icon('lock', 18)} ${lockEnabled() ? 'Alterar ou desativar o bloqueio' : 'Ativar bloqueio com PIN ou desenho'}</button>
    ${lockEnabled() ? `<div class="set-row"><span class="grow">Bloquear depois de sair do app</span><select class="input auto" data-set="lockAfter">${[[0, 'na hora'], [30, 'em 30 segundos'], [60, 'em 1 minuto'], [300, 'em 5 minutos']].map(([v, l]) => `<option value="${v}" ${(s.lockAfter ?? 30) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <button class="set-btn" data-s="lock-now">${icon('lock', 18)} Bloquear agora</button>` : ''}

    <h2 class="section">Aparência</h2>
    <div class="seg full">${[['system', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<button class="${s.theme === v ? 'on' : ''}" data-theme="${v}">${l}</button>`).join('')}</div>

    <h2 class="section">Backup</h2>
    <p class="muted small">Os dados ficam só neste celular. Se desinstalar o app, eles somem: faça backup de vez em quando.</p>
    <button class="set-btn" data-s="export">${icon('download', 18)} Exportar backup</button>
    <label class="set-btn">${icon('upload', 18)} Importar backup<input type="file" hidden accept=".json,application/json,text/plain" data-import></label>
    <button class="set-btn danger" data-s="reset">${icon('trash', 18)} Apagar todos os dados</button>
    <p class="muted small center">Minhas Finanças v1.0</p>`;
  }, {
    onClick: async (e, draw) => {
      const th = e.target.closest('[data-theme]');
      if (th) { db.setSettings({ theme: th.dataset.theme }); applyTheme(); draw(); }
      const b = e.target.closest('[data-s]');
      if (!b) return;
      switch (b.dataset.s) {
        case 'sync-connect': connectPanel(draw); break;
        case 'sync-now': (await syncNow()) ? toast('Sincronizado ✓') : toast('Não foi possível sincronizar'); break;
        case 'sync-code': copyText(configCode(), 'Código copiado! Cole no outro aparelho em Ajustes > Conectar planilha.'); break;
        case 'sync-off':
          if (await confirmDialog('Desconectar?', 'Os dados continuam neste aparelho e na planilha, mas param de sincronizar aqui.', 'Desconectar', false)) {
            db.d.settings.sync = { ...(db.s.sync || {}), enabled: false, url: '', key: '' };
            await db.save();
            draw();
          }
          break;
        case 'notif': await askNotif(); toast('Pronto'); break;
        case 'exact': await exactAlarmSettings(); break;
        case 'test': (await testNotif()) ? toast('A notificação chega em 3 segundos') : toast('Disponível no app instalado'); break;
        case 'pin': await setupLock(); draw(); break;
        case 'lock-now': lockNow(); break;
        case 'export': {
          const bytes = new TextEncoder().encode(db.exportJSON());
          await saveFile(bytes, `backup-financas-${today()}.json`, 'application/json');
          break;
        }
        case 'reset':
          if (await confirmDialog('Apagar tudo?', 'Todos os lançamentos, cartões, empréstimos e metas serão apagados' + (configured() ? ' em TODOS os aparelhos sincronizados e na planilha' : '') + '. Faça um backup antes.', 'Apagar tudo')) {
            db.reset();
            toast('Dados apagados');
          }
          break;
      }
    },
  }).el.addEventListener('change', async (e) => {
    const k = e.target.dataset.set;
    if (k) db.setSettings({ [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value });
    if (e.target.matches('[data-import]') && e.target.files[0]) {
      try {
        const text = await e.target.files[0].text();
        if (await confirmDialog('Importar backup?', 'Os dados atuais serão substituídos pelos do arquivo.', 'Importar')) {
          db.importJSON(text);
          toast('Backup importado ✓');
        }
      } catch (err) {
        toast(err.message);
      }
      e.target.value = '';
    }
  });
}

// ======================================================================
// Detalhes de um lançamento (lápis = editar, X vermelho = excluir)
// ======================================================================
function txDetail(id) {
  const tipoNome = (t) => (t.wallet ? (t.type === 'income' ? 'Crédito no vale' : 'Gasto no vale') : t.type === 'transfer' ? 'Transferência' : t.kind === 'invoice' ? 'Pagamento de fatura' : t.type === 'income' ? 'Receita' : 'Despesa');
  const { close } = simplePanel('tx-detail', 'Detalhes', () => {
    const t = db.tx(id);
    if (!t) {
      setTimeout(() => close(), 0);
      return '';
    }
    const c = db.cat(t.catId);
    const isT = t.type === 'transfer';
    const sign = t.type === 'income' ? '+ ' : isT ? '' : '− ';
    const situacao = t.wallet ? (t.type === 'income' ? (t.date > today() ? 'Crédito programado' : 'Creditado') : 'Pago com o vale')
      : isT ? 'Transferido' : t.cardId && t.kind !== 'invoice' ? `No cartão · fatura de ${monthLabel(t.invoice)}`
      : t.paid ? `${t.type === 'income' ? 'Recebido' : 'Pago'} em ${brDate(t.paidDate || t.date)}` : t.type === 'income' ? 'A receber' : 'Pendente';
    const onde = t.wallet ? `${VALES[t.wallet].icon} ${VALES[t.wallet].nome}`
      : isT ? `${db.acc(t.accountId)?.name || ''} → ${db.acc(t.toAccountId)?.name || ''}`
      : t.cardId && t.kind !== 'invoice' ? `💳 ${db.card(t.cardId)?.name || ''}` : `${db.acc(t.accountId)?.icon || '🏦'} ${db.acc(t.accountId)?.name || '—'}`;
    const linha = (rot, val) => (val ? `<div class="det-row"><span class="muted">${rot}</span><b>${val}</b></div>` : '');
    const pend = !t.paid && !t.cardId && !isT && !t.wallet;
    return `<div class="det-hero">
        <span class="det-ic" style="--c:${c?.color || '#94a3b8'}">${isT ? '🔁' : t.wallet && t.type === 'income' ? '💳' : c?.icon || '❔'}</span>
        <b class="det-title">${esc(t.desc || c?.name || tipoNome(t))}</b>
        <b class="det-val ${t.type}">${sign}${money(t.amount)}</b>
        <span class="tag-pill ${pend ? 'late' : ''}">${esc(tipoNome(t))} · ${esc(situacao)}</span>
      </div>
      <div class="card-box det-list">
        ${linha('Categoria', c ? `${c.icon} ${esc(c.name)}` : '')}
        ${linha(t.type === 'income' ? 'Data' : t.paid || t.cardId || t.wallet ? 'Data' : 'Vencimento', `${brDate(t.date)} · ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(t.date + 'T12:00').getDay()]}`)}
        ${linha(isT ? 'Contas' : t.wallet ? 'Vale' : t.cardId ? 'Cartão' : t.type === 'income' ? 'Recebido em' : 'Pago com', esc(onde))}
        ${linha('Parcela', t.inst ? `${t.inst.n} de ${t.inst.total}${t.inst.mode === 'fixo' ? ' (todo mês)' : ''}` : '')}
        ${linha('Observação', esc(t.notes || ''))}
        ${t.barcode ? `<div class="det-row"><span class="muted">Código de barras / PIX</span><button class="btn sm ghost" data-copy>${icon('copy', 16)} Copiar</button></div>` : ''}
      </div>
      ${pend ? `<button class="btn ${t.type === 'income' ? 'ok' : 'primary'} block" data-pagar>${icon('check', 18)} ${t.type === 'income' ? 'Marcar como recebido' : 'Marcar como pago'}</button>` : ''}
      <div class="grid2 det-actions">
        <button class="btn ghost" data-editar>${icon('edit', 18)} Editar</button>
        <button class="btn danger-soft" data-excluir>${icon('close', 18)} Excluir</button>
      </div>`;
  }, {
    headBtns: `<button class="icon-btn" data-editar aria-label="Editar">${icon('edit')}</button><button class="icon-btn del" data-excluir aria-label="Excluir">${icon('close')}</button>`,
    onClick: async (e) => {
      const t = db.tx(id);
      if (!t) return;
      if (e.target.closest('[data-editar]')) return t.wallet ? valeForm({}, id) : txForm({}, id);
      if (e.target.closest('[data-excluir]')) {
        if (await excluirLancamento(t)) close();
        return;
      }
      if (e.target.closest('[data-pagar]')) {
        const d = findDue('tx:' + id);
        if (d) payDialog(d);
      }
      if (e.target.closest('[data-copy]')) {
        try {
          await navigator.clipboard.writeText(t.barcode);
          toast('Código copiado ✓');
        } catch {
          dialog({ title: 'Código', message: t.barcode, cancel: null });
        }
      }
    },
  });
}

// ======================================================================
// Lista só de despesas ou só de receitas
// ======================================================================
function openTxType(type) {
  let k = st.month;
  let cat = '';
  const isExp = type === 'expense';
  simplePanel('tx-type', isExp ? 'Despesas' : 'Receitas', () => {
    const all = db.monthTxs(k).filter((t) => t.type === type && db.isStat(t));
    const list = all.filter((t) => !cat || t.catId === cat).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    const total = all.reduce((s, t) => s + t.amount, 0);
    const feito = all.filter((t) => t.paid || t.cardId).reduce((s, t) => s + t.amount, 0);
    const cats = db.byCategory(all, type);
    let last = '';
    const rows = list.map((t) => {
      const head = t.date !== last ? `<div class="day-head">${brDate(t.date)} · ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(t.date + 'T12:00').getDay()]}</div>` : '';
      last = t.date;
      return head + txRow(t);
    }).join('');
    return `${monthBar(k)}
      <div class="kpis">
        <div class="kpi"><small>Total do mês</small><b class="${type}">${money(total)}</b></div>
        <div class="kpi"><small>${isExp ? 'Pago' : 'Recebido'}</small><b>${money(feito)}</b></div>
        <div class="kpi"><small>${isExp ? 'A pagar' : 'A receber'}</small><b>${money(total - feito)}</b></div>
      </div>
      ${cats.length > 1 ? `<div class="chips"><button class="chip ${!cat ? 'on' : ''}" data-fcat="">Todas</button>${cats.map((c) => `<button class="chip ${cat === c.id ? 'on' : ''}" data-fcat="${c.id}">${c.cat.icon} ${esc(c.cat.name)} · ${money(c.v)}</button>`).join('')}</div>` : ''}
      <p class="muted small">Toque num item para ver os detalhes, editar (✏️) ou excluir (✖).</p>
      <div class="tx-list">${rows || `<div class="empty">${isExp ? '💸' : '💰'}<p>Nenhuma ${isExp ? 'despesa' : 'receita'} em ${monthLabel(k)}.</p></div>`}</div>
      <button class="btn primary block" data-new>${icon('plus', 18)} ${isExp ? 'Nova despesa' : 'Nova receita'}</button>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: (e, draw) => {
      const tx = e.target.closest('[data-tx]');
      if (tx) return txDetail(tx.dataset.tx);
      const fc = e.target.closest('[data-fcat]');
      if (fc) { cat = fc.dataset.fcat; draw(); }
      if (e.target.closest('[data-new]')) txForm({ type, date: k === ym(today()) ? today() : k + '-01' });
      if (e.target.closest('[data-act="m-prev"]')) { k = shiftMonth(k, -1); cat = ''; draw(); }
      if (e.target.closest('[data-act="m-next"]')) { k = shiftMonth(k, 1); cat = ''; draw(); }
      if (e.target.closest('[data-act="m-today"]')) { k = ym(today()); cat = ''; draw(); }
      if (e.target.closest('[data-rep]')) chooseFormat(() => specTipo(type, k));
    },
  });
}

// ======================================================================
// Análise do mês
// ======================================================================
function openAnalysis() {
  let k = st.month;
  simplePanel('analysis', 'Análise do mês', () => {
    const a = analyze(k);
    const box = (rot, val, cls = '', sub = '') => `<div class="kpi"><small>${rot}</small><b class="${cls}">${val}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`;
    const varTxt = a.varMes == null ? '—' : `${a.varMes > 0 ? '+' : ''}${Math.round(a.varMes * 100)}%`;
    const maxWd = Math.max(1, ...a.porDiaSemana);
    const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const hero = a.isCur
      ? `<div class="hero-card an-hero ${a.porDia < 0 ? 'neg' : ''}"><span class="small">Você pode gastar por dia</span>
          <b class="hero-val">${money(Math.max(0, a.porDia))}</b>
          <span class="small">${a.porDia < 0 ? `As despesas já passam das receitas em ${money(-a.livre)}` : `até o fim de ${monthLabel(k).split(' ')[0].toLowerCase()} · ${a.diasParaGastar} dia(s) contando hoje · ${money(Math.max(0, a.porSemana))} por semana`}</span>
          <span class="small">Hoje você gastou <b>${money(a.gastoHoje)}</b>${a.porDia > 0 ? ` · ${a.gastoHoje > a.porDia ? 'acima' : 'dentro'} do limite` : ''}</span></div>`
      : `<div class="hero-card an-hero ${a.projecaoResultado < 0 ? 'neg' : ''}"><span class="small">${a.isPast ? 'Resultado do mês' : 'Previsão para o mês'}</span>
          <b class="hero-val">${money(a.projecaoResultado)}</b><span class="small">${a.isPast ? 'receitas menos despesas' : `receitas lançadas menos despesas previstas (ritmo de ${money(a.mediaVar)}/dia)`}</span></div>`;
    return `${monthBar(k)}${hero}
      <div class="kpis two">
        ${box(a.isPast ? 'Gasto no mês' : 'Gasto até hoje', money(a.ateHoje), 'expense', a.dayNow ? `${a.dayNow} de ${a.dim} dias` : '')}
        ${box('Média por dia', money(a.mediaDia), '', `dia a dia: ${money(a.mediaVar)}`)}
        ${box('Previsão de despesas', money(a.projecaoDespesas), 'expense', a.agendado ? `inclui ${money(a.agendado)} já agendado` : 'no ritmo atual')}
        ${box('Previsão do resultado', money(a.projecaoResultado), a.projecaoResultado >= 0 ? 'income' : 'expense', `receitas ${money(a.receitas)}`)}
        ${a.isCur ? box('Saldo previsto nas contas', money(a.saldoPrevisto), a.saldoPrevisto >= 0 ? 'income' : 'expense', 'no fim do mês') : ''}
        ${box('Taxa de economia', a.taxaEconomia == null ? '—' : pct(a.taxaEconomia), a.taxaEconomia != null && a.taxaEconomia < 0 ? 'expense' : 'income', 'do que entrou no mês')}
        ${box('Ainda a pagar no mês', money(a.aPagar), a.aPagar ? 'expense' : '', 'contas, faturas e parcelas')}
        ${box('Ainda a receber', money(a.aReceber), 'income')}
        ${box('Vs. mês passado', varTxt, a.varMes > 0 ? 'expense' : 'income', `mesmo período: ${money(a.pAte)}`)}
        ${box('Média de gastos (3 meses)', money(a.media3), '', `receitas: ${money(a.mediaRec3)}`)}
      </div>
      <button class="card-box meta-row" data-meta><span class="grow"><b>🎯 Meta de economia mensal</b><span class="muted small">${a.meta ? `Guardar ${money(a.meta)} por mês — já descontado do limite diário` : 'Defina quanto quer guardar por mês para o limite diário considerar isso'}</span></span>${icon('edit', 18)}</button>
      ${a.alertas.length ? `<section class="card-box"><h3>Alertas e dicas</h3>${a.alertas.map((x) => `<p class="an-alert ${x.t}">${x.t === 'ruim' ? '⚠️' : x.t === 'bom' ? '✅' : '💡'} ${esc(x.m)}</p>`).join('')}</section>` : ''}
      <section class="card-box"><h3>Gasto acumulado no mês</h3>${chartAcumulado(a)}</section>
      <section class="card-box"><h3>Onde o dinheiro foi</h3>${donut(a.cats, a.despesas, { center: money(a.despesas) })}
        ${a.subiu.length ? `<p class="muted small" style="margin-top:10px">Subiram em relação ao mês passado:</p>${a.subiu.slice(0, 3).map((c) => `<div class="row small"><span class="grow">${c.cat.icon} ${esc(c.cat.name)}</span><span class="expense">+${money(c.dif)}</span></div>`).join('')}` : ''}</section>
      ${a.maiores.length ? `<section class="card-box flush"><h3 class="pad-h">Maiores despesas</h3>${a.maiores.map(txRow).join('')}</section>` : ''}
      ${a.diaTop >= 0 ? `<section class="card-box"><h3>Gastos do dia a dia por dia da semana</h3><div class="wd-bars">${a.porDiaSemana.map((v, i) => `<div class="wd"><i style="height:${Math.round((v / maxWd) * 100)}%" class="${i === a.diaTop ? 'top' : ''}"></i><span>${WD[i]}</span></div>`).join('')}</div></section>` : ''}
      <p class="muted small center">A previsão usa os lançamentos do mês (inclusive contas futuras já cadastradas) mais a sua média diária de gastos do dia a dia. Parcelas e contas que se repetem não entram na média.</p>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: async (e, draw) => {
      const tx = e.target.closest('[data-tx]');
      if (tx) return txDetail(tx.dataset.tx);
      if (e.target.closest('[data-act="m-prev"]')) { k = shiftMonth(k, -1); draw(); }
      if (e.target.closest('[data-act="m-next"]')) { k = shiftMonth(k, 1); draw(); }
      if (e.target.closest('[data-act="m-today"]')) { k = ym(today()); draw(); }
      if (e.target.closest('[data-rep]')) chooseFormat(() => specAnalise(k));
      if (e.target.closest('[data-meta]')) {
        const v = await dialog({ title: 'Meta de economia mensal', message: 'Quanto você quer guardar por mês? (0 para nenhuma)', input: true, value: db.s.saveTarget ? String(db.s.saveTarget).replace('.', ',') : '', placeholder: '0,00', ok: 'Salvar' });
        if (v == null) return;
        db.setSettings({ saveTarget: (await import('./fmt.js')).parseMoney(v) });
      }
    },
  });
}

// ======================================================================
// Vale refeição / alimentação
// ======================================================================
function openVale() {
  let k = ym(today());
  simplePanel('vale', 'Vale Refeição / Alimentação', () => {
    const w = st.vale;
    const V = VALES[w];
    const saldo = db.valeBalance(w);
    const m = db.valeMonth(w, k);
    const isCur = k === ym(today());
    const dim = new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();
    const dia = isCur ? +today().slice(8) : dim;
    const restantes = isCur ? dim - dia + 1 : 0;
    const porDia = restantes ? saldo / restantes : 0;
    const media = dia ? m.spent / dia : 0;
    const sobra = isCur ? saldo - media * (dim - dia) : null;
    const futuros = db.valeTxs(w).filter((t) => t.type === 'income' && t.date > today());
    const cats = db.byCategory(m.list.filter((t) => t.type === 'expense').map((t) => ({ ...t, kind: undefined })));
    let last = '';
    const rows = m.list.map((t) => {
      const head = t.date !== last ? `<div class="day-head">${brDate(t.date)} · ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(t.date + 'T12:00').getDay()]}</div>` : '';
      last = t.date;
      return head + txRow(t);
    }).join('');
    return `<div class="seg full two-seg"><button class="${w === 'vr' ? 'on' : ''}" data-w="vr">🍽️ Refeição</button><button class="${w === 'va' ? 'on' : ''}" data-w="va">🛒 Alimentação</button></div>
      <div class="hero-card vale-hero"><span class="small">Saldo disponível no ${V.nome}</span><b class="hero-val">${money(saldo)}</b>
        ${isCur ? `<span class="small">Dá para gastar <b>${money(Math.max(0, porDia))}</b> por dia até o fim do mês (${restantes} dia(s) contando hoje)</span>` : ''}
        ${futuros.length ? `<span class="small">Próximo crédito: ${money(futuros[futuros.length - 1].amount)} em ${brDate(futuros[futuros.length - 1].date)}</span>` : ''}</div>
      <div class="grid2"><button class="btn ok" data-novo="income">${icon('plus', 18)} Saldo recebido</button><button class="btn primary" data-novo="expense">${icon('down', 18)} Novo gasto</button></div>
      ${monthBar(k)}
      <div class="kpis">
        <div class="kpi"><small>Recebido no mês</small><b class="income">${money(m.received)}</b></div>
        <div class="kpi"><small>Gasto no mês</small><b class="expense">${money(m.spent)}</b></div>
        <div class="kpi"><small>Média por dia</small><b>${money(media)}</b></div>
      </div>
      ${isCur && m.spent ? `<p class="an-alert ${sobra >= 0 ? 'bom' : 'ruim'}">${sobra >= 0 ? '✅' : '⚠️'} No ritmo atual (${money(media)}/dia) ${sobra >= 0 ? `sobram ${money(sobra)} no fim do mês.` : `o saldo acaba antes do fim do mês (faltariam ${money(-sobra)}).`}</p>` : ''}
      ${cats.length ? `<section class="card-box"><h3>Gastos por categoria</h3>${donut(cats, m.spent, { center: money(m.spent) })}</section>` : ''}
      <p class="muted small">Toque num item para ver os detalhes, editar (✏️) ou excluir (✖). Os valores do vale ficam separados do saldo das suas contas.</p>
      <div class="tx-list">${rows || `<div class="empty">${V.icon}<p>Nada no ${V.nome} em ${monthLabel(k)}.<br>Comece registrando o saldo que você recebeu.</p></div>`}</div>`;
  }, {
    headBtns: `<button class="icon-btn" data-rep>${icon('pdf')}</button>`,
    onClick: (e, draw) => {
      const tx = e.target.closest('[data-tx]');
      if (tx) return txDetail(tx.dataset.tx);
      const w = e.target.closest('[data-w]');
      if (w) { st.vale = w.dataset.w; draw(); }
      const n = e.target.closest('[data-novo]');
      if (n) valeForm({ wallet: st.vale, type: n.dataset.novo });
      if (e.target.closest('[data-act="m-prev"]')) { k = shiftMonth(k, -1); draw(); }
      if (e.target.closest('[data-act="m-next"]')) { k = shiftMonth(k, 1); draw(); }
      if (e.target.closest('[data-act="m-today"]')) { k = ym(today()); draw(); }
      if (e.target.closest('[data-rep]')) chooseFormat(() => specVale(k));
    },
  });
}

// ======================================================================
// Relatórios (specs)
// ======================================================================
async function chooseFormat(specFn) {
  const f = await actionSheet({ title: 'Gerar relatório', items: [
    { label: 'PDF', icon: 'pdf', value: 'pdf' },
    { label: 'Excel (planilha com tabelas)', icon: 'excel', value: 'xlsx' },
  ] });
  if (!f) return;
  toast('Gerando...');
  await exportReport(specFn(), f);
}
function openReport(key) {
  const map = { home: specHome, txs: specTxs, dues: specDues, cards: () => specCard(null), loans: () => specDebts(false), fin: () => specDebts(true), budgets: () => specBudgets(st.month), goals: specGoals, accounts: specAccounts, year: specYear, analise: () => specAnalise(st.month), vale: () => specVale(st.month) };
  chooseFormat(map[key]);
}
const catName = (t) => (t.type === 'transfer' ? 'Transferência' : t.kind === 'invoice' ? 'Fatura de cartão' : db.cat(t.catId)?.name || '—');
const whereName = (t) => (t.cardId && t.kind !== 'invoice' ? `Cartão ${db.card(t.cardId)?.name || ''}` : t.type === 'transfer' ? `${db.acc(t.accountId)?.name} → ${db.acc(t.toAccountId)?.name}` : db.acc(t.accountId)?.name || '');

function specTipo(type, k) {
  const list = db.monthTxs(k).filter((t) => t.type === type && db.isStat(t)).sort((a, b) => a.date.localeCompare(b.date));
  const tot = list.reduce((s, t) => s + t.amount, 0);
  const isExp = type === 'expense';
  return {
    title: isExp ? 'Despesas' : 'Receitas', subtitle: monthLabel(k), file: `${isExp ? 'despesas' : 'receitas'}-${k}`, landscape: true,
    cards: [{ label: 'Total', value: tot, color: isExp ? 'red' : 'green' }, { label: isExp ? 'Pago' : 'Recebido', value: list.filter((t) => t.paid || t.cardId).reduce((s, t) => s + t.amount, 0) }, { label: 'Lançamentos', value: String(list.length), type: 'text' }],
    sections: [
      { title: isExp ? 'Despesas do mês' : 'Receitas do mês', columns: [{ h: 'Data', type: 'date' }, { h: 'Descrição' }, { h: 'Categoria' }, { h: 'Conta / Cartão' }, { h: 'Situação' }, { h: 'Valor', type: 'money' }],
        rows: list.map((t) => [t.date, t.desc || catName(t), catName(t), whereName(t), t.cardId ? 'No cartão' : t.paid ? (isExp ? 'Pago' : 'Recebido') : 'Pendente', t.amount]), total: ['Total', '', '', '', '', tot] },
      { title: 'Por categoria', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '%', type: 'pct' }], rows: db.byCategory(list, type).map((x) => [x.cat.name, x.v, tot ? x.v / tot : 0]), total: ['Total', tot, ''] },
    ],
  };
}
function specAnalise(k) {
  const a = analyze(k);
  return {
    title: 'Análise do mês', subtitle: monthLabel(k), file: `analise-${k}`,
    cards: [
      { label: a.isCur ? 'Pode gastar por dia' : 'Resultado', value: a.isCur ? Math.max(0, a.porDia) : a.projecaoResultado, color: 'green' },
      { label: 'Previsão de despesas', value: a.projecaoDespesas, color: 'red' },
      { label: 'Previsão do resultado', value: a.projecaoResultado, color: a.projecaoResultado >= 0 ? 'green' : 'red' },
      { label: 'Média por dia', value: a.mediaDia },
    ],
    sections: [
      { title: 'Indicadores', columns: [{ h: 'Indicador' }, { h: 'Valor' }], rows: [
        ['Receitas do mês', brl(a.receitas)], ['Despesas lançadas no mês', brl(a.despesas)], ['Gasto até hoje', brl(a.ateHoje)], ['Já agendado para os próximos dias', brl(a.agendado)],
        ['Média por dia (tudo)', brl(a.mediaDia)], ['Média por dia (dia a dia)', brl(a.mediaVar)], ['Meta de economia', brl(a.meta)], ['Pode gastar por dia', brl(Math.max(0, a.porDia))],
        ['Taxa de economia', a.taxaEconomia == null ? '—' : pct(a.taxaEconomia)], ['Vs. mesmo período do mês passado', a.varMes == null ? '—' : `${Math.round(a.varMes * 100)}%`],
        ['Média de gastos (3 meses)', brl(a.media3)], ['Ainda a pagar no mês', brl(a.aPagar)], ['Ainda a receber no mês', brl(a.aReceber)],
      ] },
      { title: 'Alertas e dicas', columns: [{ h: 'Alerta' }], rows: a.alertas.map((x) => [x.m]) },
      { title: 'Despesas por categoria', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '%', type: 'pct' }], rows: a.cats.map((x) => [x.cat.name, x.v, a.despesas ? x.v / a.despesas : 0]), total: ['Total', a.despesas, ''] },
      { title: 'Maiores despesas', columns: [{ h: 'Data', type: 'date' }, { h: 'Descrição' }, { h: 'Categoria' }, { h: 'Valor', type: 'money' }], rows: a.maiores.map((t) => [t.date, t.desc || catName(t), catName(t), t.amount]) },
    ],
  };
}
function specVale(k) {
  const secs = [];
  const cards = [];
  for (const w of ['vr', 'va']) {
    if (!db.valeTxs(w).length) continue;
    const m = db.valeMonth(w, k);
    cards.push({ label: `Saldo ${VALES[w].nome}`, value: db.valeBalance(w), color: 'green' }, { label: `Gasto no mês (${VALES[w].nome.replace('Vale ', '')})`, value: m.spent, color: 'red' });
    secs.push({ title: `${VALES[w].nome} — ${monthLabel(k)}`, columns: [{ h: 'Data', type: 'date' }, { h: 'Descrição' }, { h: 'Categoria' }, { h: 'Tipo' }, { h: 'Valor', type: 'money', color: true }],
      rows: m.list.slice().reverse().map((t) => [t.date, t.desc || (t.type === 'income' ? 'Crédito' : catName(t)), t.type === 'income' ? '' : catName(t), t.type === 'income' ? 'Crédito' : 'Gasto', t.type === 'income' ? t.amount : -t.amount]),
      total: ['Saldo do mês', '', '', '', r2(m.received - m.spent)] });
  }
  return { title: 'Vale refeição / alimentação', subtitle: monthLabel(k), file: `vale-${k}`, cards, sections: secs.length ? secs : [{ title: 'Sem lançamentos', columns: [{ h: '—' }], rows: [] }] };
}
function specHome() {
  const k = st.month, m = db.monthStats(k);
  const exp = db.byCategory(m.list, 'expense'), inc = db.byCategory(m.list, 'income');
  const [a, b] = [k + '-01', k + '-31'];
  return {
    title: 'Resumo financeiro', subtitle: monthLabel(k), file: `resumo-${k}`,
    cards: [
      { label: 'Receitas do mês', value: m.income, color: 'green' }, { label: 'Despesas do mês', value: m.expense, color: 'red' },
      { label: 'Resultado do mês', value: m.balance, color: m.balance >= 0 ? 'green' : 'red' }, { label: 'Saldo atual', value: db.totalBalance() },
    ],
    sections: [
      { title: 'Despesas por categoria', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '% do total', type: 'pct' }], rows: exp.map((x) => [x.cat.name, x.v, m.expense ? x.v / m.expense : 0]), total: ['Total', m.expense, ''] },
      { title: 'Receitas por categoria', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '% do total', type: 'pct' }], rows: inc.map((x) => [x.cat.name, x.v, m.income ? x.v / m.income : 0]), total: ['Total', m.income, ''] },
      { title: 'Saldo das contas', columns: [{ h: 'Conta' }, { h: 'Saldo', type: 'money' }], rows: db.accounts().map((x) => [x.name, db.accountBalance(x.id)]), total: ['Total', db.accounts().filter((x) => !x.excludeTotal).reduce((s, x) => s + db.accountBalance(x.id), 0)] },
      { title: 'Pendências do mês', columns: [{ h: 'Vencimento', type: 'date' }, { h: 'Descrição' }, { h: 'Tipo' }, { h: 'Valor', type: 'money' }], rows: db.dues({ from: a, until: b }).map((d) => [d.due, d.title, d.dir === 'in' ? 'A receber' : 'A pagar', d.amount]) },
      { title: 'Últimos 6 meses', columns: [{ h: 'Mês' }, { h: 'Receitas', type: 'money' }, { h: 'Despesas', type: 'money' }, { h: 'Resultado', type: 'money', color: true }], rows: db.lastMonths(6).map((x) => [monthLabel(x.k), x.income, x.expense, x.balance]), total: ['Total', ...['income', 'expense', 'balance'].map((f) => db.lastMonths(6).reduce((s, x) => s + x[f], 0))] },
    ],
  };
}
function specTxs() {
  const k = st.month, m = db.monthStats(k);
  const list = db.monthTxs(k).sort((a, b) => a.date.localeCompare(b.date));
  return {
    title: 'Lançamentos', subtitle: monthLabel(k), file: `lancamentos-${k}`, landscape: true,
    cards: [{ label: 'Receitas', value: m.income, color: 'green' }, { label: 'Despesas', value: m.expense, color: 'red' }, { label: 'Resultado', value: m.balance, color: m.balance >= 0 ? 'green' : 'red' }, { label: 'Lançamentos', value: String(list.length), type: 'text' }],
    sections: [
      { title: 'Extrato do mês', columns: [{ h: 'Data', type: 'date' }, { h: 'Descrição' }, { h: 'Categoria' }, { h: 'Conta / Cartão' }, { h: 'Parcela' }, { h: 'Situação' }, { h: 'Valor', type: 'money', color: true }],
        rows: list.map((t) => [t.date, t.desc || catName(t), catName(t), whereName(t), t.inst ? `${t.inst.n}/${t.inst.total}` : '', t.type === 'transfer' ? 'Transferência' : t.cardId && t.kind !== 'invoice' ? 'No cartão' : t.paid ? (t.type === 'income' ? 'Recebido' : 'Pago') : 'Pendente', t.type === 'income' ? t.amount : t.type === 'transfer' ? 0 : -t.amount]),
        total: ['Total', '', '', '', '', '', r2(m.income - m.expense)] },
      { title: 'Despesas por categoria', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '%', type: 'pct' }], rows: db.byCategory(m.list).map((x) => [x.cat.name, x.v, m.expense ? x.v / m.expense : 0]), total: ['Total', m.expense, ''] },
    ],
  };
}
function specYear() {
  const y = st.month.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`).map((k) => ({ k, ...db.monthStats(k) }));
  const inc = months.reduce((s, x) => s + x.income, 0), exp = months.reduce((s, x) => s + x.expense, 0);
  const all = months.flatMap((x) => x.list);
  return {
    title: 'Resumo do ano', subtitle: y, file: `resumo-ano-${y}`,
    cards: [{ label: 'Receitas no ano', value: inc, color: 'green' }, { label: 'Despesas no ano', value: exp, color: 'red' }, { label: 'Resultado', value: inc - exp, color: inc - exp >= 0 ? 'green' : 'red' }, { label: 'Média de gastos/mês', value: exp / 12 }],
    sections: [
      { title: 'Mês a mês', columns: [{ h: 'Mês' }, { h: 'Receitas', type: 'money' }, { h: 'Despesas', type: 'money' }, { h: 'Resultado', type: 'money', color: true }], rows: months.map((x) => [monthLabel(x.k), x.income, x.expense, x.balance]), total: ['Total', inc, exp, inc - exp] },
      { title: 'Despesas por categoria no ano', columns: [{ h: 'Categoria' }, { h: 'Valor', type: 'money' }, { h: '%', type: 'pct' }], rows: db.byCategory(all).map((x) => [x.cat.name, x.v, exp ? x.v / exp : 0]), total: ['Total', exp, ''] },
    ],
  };
}
function specDues() {
  const d = db.dues();
  const t = today();
  const row = (x) => [x.due, x.title, x.sub || '', x.dir === 'in' ? 'A receber' : 'A pagar', x.amount];
  const cols = [{ h: 'Vencimento', type: 'date' }, { h: 'Descrição' }, { h: 'Detalhe' }, { h: 'Tipo' }, { h: 'Valor', type: 'money' }];
  const late = d.filter((x) => x.due < t), next = d.filter((x) => x.due >= t && x.due <= addDays(t, 30)), later = d.filter((x) => x.due > addDays(t, 30) && x.due <= addDays(t, 365));
  const sum = (l, dir) => l.filter((x) => x.dir === dir).reduce((s, x) => s + x.amount, 0);
  return {
    title: 'Contas a pagar e receber', subtitle: `Posição em ${brDate(t)}`, file: 'contas',
    cards: [{ label: 'Vencido (a pagar)', value: sum(late, 'out'), color: 'red' }, { label: 'A pagar em 30 dias', value: sum(next, 'out') }, { label: 'A receber em 30 dias', value: sum(next, 'in'), color: 'green' }, { label: 'Atrasado (a receber)', value: sum(late, 'in') }],
    sections: [
      { title: 'Vencidas', columns: cols, rows: late.map(row), total: ['Total', '', '', '', late.reduce((s, x) => s + x.amount, 0)] },
      { title: 'Próximos 30 dias', columns: cols, rows: next.map(row), total: ['Total', '', '', '', next.reduce((s, x) => s + x.amount, 0)] },
      { title: 'De 30 dias a 1 ano', columns: cols, rows: later.map(row), total: ['Total', '', '', '', later.reduce((s, x) => s + x.amount, 0)] },
    ],
  };
}
function specCard(cardId, key) {
  const cards = cardId ? [db.card(cardId)] : db.d.cards.filter((c) => !c.archived);
  const secs = [];
  const cardsSum = [];
  for (const c of cards) {
    const k = key || db.currentInvoiceKey(c);
    const inv = db.invoice(c.id, k);
    cardsSum.push([c.name, c.limit || 0, db.cardUsed(c.id), (c.limit || 0) - db.cardUsed(c.id), inv.total, inv.due]);
    secs.push({ title: `${c.name} — fatura ${monthLabel(k)}`, columns: [{ h: 'Data', type: 'date' }, { h: 'Descrição' }, { h: 'Categoria' }, { h: 'Parcela' }, { h: 'Valor', type: 'money' }],
      rows: inv.items.map((t) => [t.date, t.desc || catName(t), catName(t), t.inst ? `${t.inst.n}/${t.inst.total}` : '', t.type === 'income' ? -t.amount : t.amount]), total: ['Total', '', '', '', inv.total] });
    const fut = db.invoiceKeys(c.id).filter((x) => x > k).map((x) => db.invoice(c.id, x)).filter((x) => x.total);
    if (fut.length) secs.push({ title: `${c.name} — próximas faturas`, columns: [{ h: 'Fatura' }, { h: 'Vencimento', type: 'date' }, { h: 'Valor', type: 'money' }], rows: fut.map((x) => [monthLabel(x.key), x.due, x.total]), total: ['Total', '', fut.reduce((s, x) => s + x.total, 0)] });
  }
  const one = cardId ? db.invoice(cardId, key || db.currentInvoiceKey(cards[0])) : null;
  return {
    title: cardId ? `Cartão ${cards[0].name}` : 'Cartões de crédito', subtitle: one ? `Fatura de ${monthLabel(one.key)} · ${one.status}` : `Posição em ${brDate(today())}`, file: cardId ? `cartao-${cards[0].name}` : 'cartoes',
    cards: one ? [{ label: 'Total da fatura', value: one.total }, { label: 'Vencimento', value: brDate(one.due), type: 'text' }, { label: 'Fechamento', value: brDate(one.close), type: 'text' }, { label: 'Limite disponível', value: (cards[0].limit || 0) - db.cardUsed(cardId), color: 'green' }]
      : [{ label: 'Faturas atuais', value: cardsSum.reduce((s, x) => s + x[4], 0) }, { label: 'Limite total', value: cardsSum.reduce((s, x) => s + x[1], 0) }, { label: 'Limite usado', value: cardsSum.reduce((s, x) => s + x[2], 0), color: 'red' }],
    sections: [...(cardId ? [] : [{ title: 'Resumo dos cartões', columns: [{ h: 'Cartão' }, { h: 'Limite', type: 'money' }, { h: 'Usado', type: 'money' }, { h: 'Disponível', type: 'money' }, { h: 'Fatura atual', type: 'money' }, { h: 'Vencimento', type: 'date' }], rows: cardsSum }]), ...secs],
  };
}
function specDebts(fin, onlyId) {
  const list = db.d.debts.filter((x) => (onlyId ? x.id === onlyId : fin ? x.kind === 'financiamento' : x.kind !== 'financiamento'));
  const kindL = { peguei: 'Devo', emprestei: 'Me devem', financiamento: 'Financiamento' };
  const secs = [{
    title: fin ? 'Financiamentos' : 'Empréstimos',
    columns: [{ h: 'Nome' }, { h: 'Tipo' }, { h: 'Valor', type: 'money' }, { h: 'Total c/ juros', type: 'money' }, { h: 'Pago', type: 'money' }, { h: 'Restante', type: 'money' }, { h: 'Parcelas' }, { h: 'Próx. vencimento', type: 'date' }],
    rows: list.map((x) => { const s = db.debtSummary(x); return [x.name, kindL[x.kind], x.principal, s.total, s.paidValue, s.remaining, `${s.paidCount}/${x.schedule.length}`, s.next?.due || '']; }),
    total: ['Total', '', list.reduce((s, x) => s + x.principal, 0), '', list.reduce((s, x) => s + db.debtSummary(x).paidValue, 0), list.reduce((s, x) => s + db.debtSummary(x).remaining, 0), '', ''],
  }];
  for (const x of list) {
    secs.push({ title: `${x.name} — parcelas`, columns: [{ h: 'Nº', type: 'int' }, { h: 'Vencimento', type: 'date' }, { h: 'Parcela', type: 'money' }, { h: 'Juros', type: 'money' }, { h: 'Amortização', type: 'money' }, { h: 'Saldo devedor', type: 'money' }, { h: 'Situação' }],
      rows: x.schedule.map((p) => [p.n, p.due, p.paidAmount ?? p.amount, p.interest, p.amort, p.balance, p.paid ? `${x.kind === 'emprestei' ? 'Recebida' : 'Paga'} ${brDate(p.paidDate)}` : p.due < today() ? 'Atrasada' : 'Em aberto']),
      total: ['Total', '', x.schedule.reduce((s, p) => s + (p.paidAmount ?? p.amount), 0), x.schedule.reduce((s, p) => s + p.interest, 0), x.schedule.reduce((s, p) => s + p.amort, 0), '', ''] });
  }
  const s1 = list.length === 1 ? db.debtSummary(list[0]) : null;
  return {
    title: onlyId ? list[0].name : fin ? 'Financiamentos' : 'Empréstimos', subtitle: `Posição em ${brDate(today())}`, file: onlyId ? list[0].name : fin ? 'financiamentos' : 'emprestimos', landscape: true,
    cards: s1 ? [{ label: 'Valor', value: list[0].principal }, { label: 'Total com juros', value: s1.total }, { label: 'Já pago', value: s1.paidValue, color: 'green' }, { label: 'Restante', value: s1.remaining, color: 'red' }]
      : [{ label: 'Total restante', value: list.filter((x) => x.kind !== 'emprestei').reduce((s, x) => s + db.debtSummary(x).remaining, 0), color: 'red' }, { label: 'A receber', value: list.filter((x) => x.kind === 'emprestei').reduce((s, x) => s + db.debtSummary(x).remaining, 0), color: 'green' }],
    sections: secs,
  };
}
function specBudgets(k) {
  const l = db.budgetStatus(k);
  return {
    title: 'Orçamentos', subtitle: monthLabel(k), file: `orcamentos-${k}`,
    cards: [{ label: 'Orçado', value: l.reduce((s, b) => s + b.limit, 0) }, { label: 'Gasto', value: l.reduce((s, b) => s + b.spent, 0), color: 'red' }, { label: 'Disponível', value: l.reduce((s, b) => s + b.limit - b.spent, 0), color: 'green' }],
    sections: [{ title: 'Planejado x gasto', columns: [{ h: 'Categoria' }, { h: 'Orçamento', type: 'money' }, { h: 'Gasto', type: 'money' }, { h: 'Disponível', type: 'money', color: true }, { h: '% usado', type: 'pct' }], rows: l.map((b) => [b.cat.name, b.limit, b.spent, b.limit - b.spent, b.pct]), total: ['Total', l.reduce((s, b) => s + b.limit, 0), l.reduce((s, b) => s + b.spent, 0), l.reduce((s, b) => s + b.limit - b.spent, 0), ''] }],
  };
}
function specGoals() {
  const g = db.d.goals;
  return {
    title: 'Metas', subtitle: `Posição em ${brDate(today())}`, file: 'metas',
    cards: [{ label: 'Total guardado', value: g.reduce((s, x) => s + db.goalSaved(x), 0), color: 'green' }, { label: 'Objetivo total', value: g.reduce((s, x) => s + x.target, 0) }],
    sections: [
      { title: 'Metas', columns: [{ h: 'Meta' }, { h: 'Objetivo', type: 'money' }, { h: 'Guardado', type: 'money' }, { h: 'Falta', type: 'money' }, { h: '%', type: 'pct' }, { h: 'Prazo', type: 'date' }], rows: g.map((x) => [x.name, x.target, db.goalSaved(x), Math.max(0, x.target - db.goalSaved(x)), db.goalSaved(x) / x.target, x.deadline || '']) },
      { title: 'Movimentações', columns: [{ h: 'Data', type: 'date' }, { h: 'Meta' }, { h: 'Tipo' }, { h: 'Observação' }, { h: 'Valor', type: 'money', color: true }], rows: g.flatMap((x) => x.moves.map((m) => [m.date, x.name, m.amount >= 0 ? 'Guardado' : 'Retirado', m.note || '', m.amount])).sort((a, b) => a[0].localeCompare(b[0])) },
    ],
  };
}
function specAccounts() {
  const accs = db.accounts();
  return {
    title: 'Contas e saldos', subtitle: `Posição em ${brDate(today())}`, file: 'contas-saldos',
    cards: [{ label: 'Saldo total', value: db.totalBalance() }, { label: 'Previsto fim do mês', value: db.forecast(ym(today())) }],
    sections: [{ title: 'Saldos', columns: [{ h: 'Conta' }, { h: 'Saldo inicial', type: 'money' }, { h: 'Saldo atual', type: 'money', color: true }], rows: accs.map((a) => [a.name, a.initial || 0, db.accountBalance(a.id)]), total: ['Total', '', db.totalBalance()] }],
  };
}

// ======================================================================
// Eventos
// ======================================================================
async function fab() {
  const v = await actionSheet({ items: [
    { label: 'Despesa', icon: 'down', value: 'expense' },
    { label: 'Receita', icon: 'up', value: 'income' },
    ...(db.d.cards.length ? [{ label: 'Compra no cartão', icon: 'card', value: 'card' }] : []),
    { label: 'Conta a pagar / boleto', icon: 'bill', value: 'bill' },
    { label: 'Transferência entre contas', icon: 'swap', value: 'transfer' },
    { label: 'Gasto no vale refeição/alimentação', icon: 'wallet', value: 'vale' },
  ] });
  if (v === 'vale') valeForm({ wallet: st.vale, type: 'expense' });
  if (v === 'expense' || v === 'income' || v === 'transfer') txForm({ type: v });
  if (v === 'card') txForm({ type: 'expense', card: true });
  if (v === 'bill') txForm({ type: 'expense', bill: true });
}

function findDue(key) {
  return db.dues().find((d) => d.key === key);
}
async function dueDetail(d) {
  if (d.kind === 'fatura') return openCard(d.ref, d.inv);
  if (d.kind === 'parcela') return openDebt(d.ref);
  const t = db.tx(d.ref);
  const items = [{ label: d.dir === 'in' ? 'Marcar como recebido' : 'Marcar como pago', icon: 'check', value: 'pay' }];
  if (t.barcode) items.push({ label: 'Copiar código de barras / PIX', icon: 'copy', value: 'copy' });
  items.push({ label: 'Editar', icon: 'edit', value: 'edit' });
  const v = await actionSheet({ title: `${d.title} · ${brl(d.amount)}`, items });
  if (v === 'pay') payDialog(d);
  if (v === 'edit') txForm({}, t.id);
  if (v === 'copy') {
    try {
      await navigator.clipboard.writeText(t.barcode);
      toast('Código copiado ✓');
    } catch {
      dialog({ title: 'Código', message: t.barcode, cancel: null });
    }
  }
}

function openMore(v) {
  ({ analise: () => openAnalysis(), vale: () => openVale(), loans: () => openDebts(false), fin: () => openDebts(true), budgets: openBudgets, goals: openGoals, accounts: openAccounts, categories: openCategories, reports: openReports, settings: openSettings })[v]?.();
}

$app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-act],[data-tx],[data-due],[data-pay],[data-card],[data-txf],[data-side],[data-report]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { st.tab = d.tab; window.scrollTo(0, 0); return render(); }
  if (d.tx) return txDetail(d.tx);
  if (d.pay) { const x = findDue(d.pay); if (x) payDialog(x); return; }
  if (d.due) { const x = findDue(d.due); if (x) dueDetail(x); return; }
  if (d.card) return openCard(d.card);
  if (d.txf) { st.txFilter = d.txf; return render(); }
  if (d.side) { st.dueSide = d.side; return render(); }
  if (d.report) return openReport(d.report);
  switch (d.act) {
    case 'fab': fab(); break;
    case 'm-prev': st.month = shiftMonth(st.month, -1); render(); break;
    case 'm-next': st.month = shiftMonth(st.month, 1); render(); break;
    case 'm-today': st.month = ym(today()); render(); break;
    case 'eye': db.setSettings({ hideValues: !db.s.hideValues }); break;
    case 'go-dues': st.tab = 'dues'; st.dueSide = 'pagar'; render(); break;
    case 'new-bill': txForm({ type: st.dueSide === 'pagar' ? 'expense' : 'income', bill: true }); break;
    case 'new-card': cardForm(); break;
    case 'card-buy': txForm({ type: 'expense', card: true }); break;
    case 'open': openMore(d.v); break;
    case 'list-type': openTxType(d.v); break;
    case 'analise': openAnalysis(); break;
    case 'sync': syncNow().then((ok) => toast(ok ? 'Sincronizado ✓' : 'Erro: ' + syncStatus.error)); break;
  }
});
$app.addEventListener('input', (e) => {
  if (e.target.id === 'txq') {
    st.txQ = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = document.getElementById('txq');
    q.focus();
    q.setSelectionRange(pos, pos);
  }
});

// ---------- links vindos de widgets / notificações ----------
export function handleLink(url) {
  if (!url || !url.startsWith('financas://')) return;
  const [, action] = url.match(/^financas:\/\/([^/?#]+)/) || [];
  while (hasOverlay()) closeTopOverlay();
  if (action === 'novo') { st.tab = 'home'; render(); return fab(); }
  if (action === 'despesa') { render(); return txForm({ type: 'expense' }); }
  if (action === 'contas') { st.tab = 'dues'; st.dueSide = 'pagar'; return render(); }
  st.tab = 'home';
  render();
}

App.addListener('backButton', () => {
  if (closeTopOverlay()) return;
  if (st.tab !== 'home') { st.tab = 'home'; return render(); }
  App.minimizeApp();
});

db.on(() => {
  render();
  afterChange();
});
db.onLocal(() => scheduleSync());

(async function init() {
  await db.load();
  applyTheme();
  // a tela de bloqueio entra antes do conteúdo (nada aparece por trás)
  const bloqueio = checkLock();
  render();
  await bloqueio;
  initNative(handleLink);
  afterChange();
  if (!native) window.__db = db; // testes no navegador
  if (configured()) syncNow();
  // sincroniza ao voltar para o app/aba e, no computador, a cada minuto
  let saiuEm = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    // no computador/navegador, bloqueia ao voltar para a aba (no app isso é feito em native.js)
    if (!native) {
      if (document.visibilityState === 'hidden') { saiuEm = Date.now(); showShade(); }
      else onResume(Date.now() - saiuEm);
    }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 60000);
})();

export { lockNow };
