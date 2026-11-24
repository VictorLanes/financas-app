import { getJSON, setJSON } from './storage.js';
import { uid, r2, today, ym, addMonths, monthDays, shiftMonth, parseD } from './fmt.js';

// ---------------------------------------------------------------------------
// Modelo de dados (tudo salvo localmente)
// ---------------------------------------------------------------------------
const EXP = [
  ['Alimentação', '🍔', '#f97316'], ['Mercado', '🛒', '#22c55e'], ['Moradia', '🏠', '#8b5cf6'], ['Contas da casa', '💡', '#eab308'],
  ['Transporte', '🚗', '#3b82f6'], ['Saúde', '💊', '#ef4444'], ['Educação', '📚', '#06b6d4'], ['Lazer', '🎉', '#ec4899'],
  ['Compras', '🛍️', '#a855f7'], ['Beleza', '💅', '#f472b6'], ['Assinaturas', '📺', '#6366f1'], ['Pets', '🐾', '#a16207'],
  ['Presentes', '🎁', '#e11d48'], ['Impostos e taxas', '🧾', '#64748b'], ['Empréstimos', '🤝', '#0f766e'], ['Financiamentos', '🏦', '#1e40af'],
  ['Outros', '📦', '#94a3b8'],
];
const INC = [
  ['Salário', '💼', '#16a34a'], ['Freelance', '💻', '#0ea5e9'], ['Vendas', '🏷️', '#f59e0b'], ['Investimentos', '📈', '#10b981'],
  ['Presente', '🎁', '#ec4899'], ['Reembolso', '↩️', '#64748b'], ['Empréstimos recebidos', '🤝', '#0f766e'], ['Outras receitas', '💰', '#84cc16'],
];

function seed() {
  return {
    version: 1,
    accounts: [
      // ids fixos: assim os itens padrão são os mesmos em todos os aparelhos
      { id: 'acc-corrente', name: 'Conta corrente', type: 'corrente', initial: 0, color: '#7c3aed', icon: '🏦' },
      { id: 'acc-carteira', name: 'Carteira', type: 'dinheiro', initial: 0, color: '#16a34a', icon: '👛' },
    ],
    categories: [
      ...EXP.map(([name, icon, color], i) => ({ id: 'ce' + i, type: 'expense', name, icon, color })),
      ...INC.map(([name, icon, color], i) => ({ id: 'ci' + i, type: 'income', name, icon, color })),
    ],
    txs: [],
    cards: [],
    debts: [],
    budgets: {},
    budgetsU: 0,
    goals: [],
    deleted: {}, // id -> quando foi apagado (para a sincronização)
    meta: { touched: false },
    settings: { theme: 'system', reminderDays: 1, reminderHour: 9, hideValues: false, widgetHide: false, pin: null },
  };
}

export const SYNC_COLLS = ['accounts', 'categories', 'txs', 'cards', 'debts', 'goals'];

class DB {
  constructor() {
    this.d = seed();
    this.listeners = new Set();
    this.localListeners = new Set();
    this.snap = new Map();
    this.snapBudgets = '';
  }
  async load() {
    const saved = await getJSON('fin_data', null);
    if (saved) {
      const base = seed();
      this.d = { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) } };
      // dados de antes da sincronização: se já tem algo, conta como "usado"
      if (!saved.meta) this.d.meta = { touched: !!(saved.txs?.length || saved.cards?.length || saved.debts?.length || saved.goals?.length) };
    } else {
      this.d = seed();
      await this.save();
    }
    this.rebuildSnap();
  }
  async save() {
    await setJSON('fin_data', this.d);
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** só alterações feitas neste aparelho (para disparar a sincronização) */
  onLocal(fn) {
    this.localListeners.add(fn);
  }
  // ---- controle de alterações por item (usado na sincronização) ----
  rebuildSnap() {
    this.snap.clear();
    for (const c of SYNC_COLLS) for (const it of this.d[c] || []) {
      const { u, ...rest } = it;
      this.snap.set(c + ':' + it.id, JSON.stringify(rest));
    }
    this.snapBudgets = JSON.stringify(this.d.budgets || {});
  }
  stamp() {
    const now = Date.now();
    const seen = new Set();
    let changed = false;
    this.d.deleted = this.d.deleted || {};
    for (const c of SYNC_COLLS) for (const it of this.d[c] || []) {
      const k = c + ':' + it.id;
      seen.add(k);
      const { u, ...rest } = it;
      const s = JSON.stringify(rest);
      if (this.snap.get(k) !== s) {
        it.u = now;
        this.snap.set(k, s);
        changed = true;
      }
    }
    for (const k of [...this.snap.keys()]) if (!seen.has(k)) {
      this.d.deleted[k.slice(k.indexOf(':') + 1)] = now;
      this.snap.delete(k);
      changed = true;
    }
    const b = JSON.stringify(this.d.budgets || {});
    if (b !== this.snapBudgets) {
      this.d.budgetsU = now;
      this.snapBudgets = b;
      changed = true;
    }
    return changed;
  }
  commit() {
    const changed = this.stamp();
    if (changed) this.d.meta = { ...(this.d.meta || {}), touched: true };
    this.save();
    this.listeners.forEach((fn) => fn());
    if (changed) this.localListeners.forEach((fn) => fn());
  }
  /** parte dos dados que vai para a planilha */
  syncDoc() {
    const o = { budgets: this.d.budgets, budgetsU: this.d.budgetsU || 0, deleted: this.d.deleted || {} };
    for (const c of SYNC_COLLS) o[c] = this.d[c];
    return o;
  }
  get pristine() {
    return !this.d.meta?.touched;
  }
  /** aplica os dados vindos da planilha (sem disparar nova sincronização) */
  async applySync(doc) {
    for (const c of SYNC_COLLS) this.d[c] = doc[c] || [];
    this.d.budgets = doc.budgets || {};
    this.d.budgetsU = doc.budgetsU || 0;
    this.d.deleted = doc.deleted || {};
    this.d.meta = { ...(this.d.meta || {}), touched: true };
    this.rebuildSnap();
    await this.save();
    this.listeners.forEach((fn) => fn());
  }
  get s() {
    return this.d.settings;
  }
  setSettings(p) {
    Object.assign(this.d.settings, p);
    this.commit();
  }

  // ---------------- consultas básicas ----------------
  acc(id) { return this.d.accounts.find((a) => a.id === id); }
  cat(id) { return this.d.categories.find((c) => c.id === id); }
  card(id) { return this.d.cards.find((c) => c.id === id); }
  debt(id) { return this.d.debts.find((x) => x.id === id); }
  goal(id) { return this.d.goals.find((x) => x.id === id); }
  tx(id) { return this.d.txs.find((t) => t.id === id); }
  cats(type) { return this.d.categories.filter((c) => c.type === type && !c.archived).sort((a, b) => a.name.localeCompare(b.name)); }
  catByName(type, name) { return this.d.categories.find((c) => c.type === type && c.name === name); }
  accounts(all = false) { return this.d.accounts.filter((a) => all || !a.archived); }

  // ---------------- saldos ----------------
  accountBalance(id, upTo = null) {
    const a = this.acc(id);
    let b = Number(a?.initial) || 0;
    for (const t of this.d.txs) {
      if (t.wallet || !t.paid || t.cardId && t.kind !== 'invoice') continue;
      const d = t.paidDate || t.date;
      if (upTo && d > upTo) continue;
      if (t.type === 'income' && t.accountId === id) b += t.amount;
      if (t.type === 'expense' && t.accountId === id) b -= t.amount;
      if (t.type === 'transfer') {
        if (t.accountId === id) b -= t.amount;
        if (t.toAccountId === id) b += t.amount;
      }
    }
    return r2(b);
  }
  totalBalance() {
    return r2(this.accounts().filter((a) => !a.excludeTotal).reduce((s, a) => s + this.accountBalance(a.id), 0));
  }
  /** saldo previsto no fim do mês: saldo atual + a receber − a pagar até o fim do mês */
  forecast(k) {
    const end = monthDays(k)[1];
    const items = this.dues({ until: end });
    return r2(this.totalBalance() + items.reduce((s, x) => s + (x.dir === 'in' ? x.amount : -x.amount), 0));
  }

  // lançamentos que contam como receita/despesa (competência)
  isStat(t) {
    return t.type !== 'transfer' && t.kind !== 'invoice' && t.kind !== 'goal';
  }
  monthTxs(k) {
    const [a, b] = monthDays(k);
    // lançamentos do vale refeição/alimentação ficam separados (não entram em saldo, receitas e despesas)
    return this.d.txs.filter((t) => !t.wallet && t.date >= a && t.date <= b);
  }
  monthStats(k) {
    const list = this.monthTxs(k).filter((t) => this.isStat(t));
    const inc = list.filter((t) => t.type === 'income');
    const exp = list.filter((t) => t.type === 'expense');
    const sum = (l) => r2(l.reduce((s, t) => s + t.amount, 0));
    return {
      income: sum(inc), expense: sum(exp),
      incomePaid: sum(inc.filter((t) => t.paid)), expensePaid: sum(exp.filter((t) => t.paid || t.cardId)),
      balance: r2(sum(inc) - sum(exp)), list,
    };
  }
  byCategory(list, type = 'expense') {
    const g = {};
    list.filter((t) => t.type === type && this.isStat(t)).forEach((t) => (g[t.catId] = r2((g[t.catId] || 0) + t.amount)));
    return Object.entries(g).map(([id, v]) => ({ cat: this.cat(id) || { name: 'Sem categoria', icon: '❔', color: '#94a3b8' }, id, v })).sort((a, b) => b.v - a.v);
  }

  // ---------------- cartão de crédito ----------------
  /** fatura ('AAAA-MM' do vencimento) de uma compra feita em `date` */
  invoiceFor(card, date) {
    const d = parseD(date);
    let m = d.getMonth() + (d.getDate() >= card.closingDay ? 1 : 0);
    if (card.dueDay <= card.closingDay) m += 1;
    const t = new Date(d.getFullYear(), m, 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  }
  invoiceDue(card, key) {
    return addMonths(key + '-01', 0, card.dueDay);
  }
  invoiceClose(card, key) {
    return addMonths(key + '-01', card.dueDay <= card.closingDay ? -1 : 0, card.closingDay);
  }
  invoicePayment(cardId, key) {
    return this.d.txs.find((t) => t.kind === 'invoice' && t.cardId === cardId && t.invoice === key);
  }
  invoice(cardId, key) {
    const card = this.card(cardId);
    const items = this.d.txs.filter((t) => t.cardId === cardId && t.kind !== 'invoice' && t.invoice === key).sort((a, b) => a.date.localeCompare(b.date));
    const total = r2(items.reduce((s, t) => s + (t.type === 'income' ? -t.amount : t.amount), 0));
    const pay = this.invoicePayment(cardId, key);
    const due = this.invoiceDue(card, key);
    const close = this.invoiceClose(card, key);
    const t = today();
    const status = pay ? 'paga' : t >= close ? (t > due ? 'vencida' : 'fechada') : 'aberta';
    return { card, key, items, total, due, close, status, pay };
  }
  invoiceKeys(cardId) {
    const set = new Set(this.d.txs.filter((t) => t.cardId === cardId && t.invoice).map((t) => t.invoice));
    const card = this.card(cardId);
    if (card) set.add(this.invoiceFor(card, today()));
    return [...set].sort();
  }
  currentInvoiceKey(card) {
    return this.invoiceFor(card, today());
  }
  cardUsed(cardId) {
    // limite usado = tudo que ainda não foi pago (inclui parcelas futuras)
    return r2(this.invoiceKeys(cardId).reduce((s, k) => {
      const inv = this.invoice(cardId, k);
      return s + (inv.pay ? 0 : Math.max(0, inv.total));
    }, 0));
  }

  // ---------------- contas a pagar / receber ----------------
  /** tudo que está pendente: lançamentos não pagos, faturas e parcelas */
  dues({ until = null, from = null } = {}) {
    const out = [];
    for (const t of this.d.txs) {
      if (t.wallet || t.paid || t.cardId || t.type === 'transfer') continue;
      out.push({ key: 'tx:' + t.id, kind: t.type === 'income' ? 'receber' : 'pagar', dir: t.type === 'income' ? 'in' : 'out', title: t.desc || this.cat(t.catId)?.name || 'Lançamento', amount: t.amount, due: t.date, ref: t.id, icon: this.cat(t.catId)?.icon || '🧾', sub: this.cat(t.catId)?.name || '' });
    }
    for (const c of this.d.cards) {
      if (c.archived) continue;
      for (const k of this.invoiceKeys(c.id)) {
        const inv = this.invoice(c.id, k);
        if (inv.pay || inv.total <= 0) continue;
        out.push({ key: `inv:${c.id}:${k}`, kind: 'fatura', dir: 'out', title: `Fatura ${c.name}`, amount: inv.total, due: inv.due, ref: c.id, inv: k, icon: '💳', sub: inv.status === 'aberta' ? 'fatura aberta' : 'fatura fechada' });
      }
    }
    for (const x of this.d.debts) {
      if (x.archived) continue;
      for (const p of x.schedule) {
        if (p.paid) continue;
        const lent = x.kind === 'emprestei';
        out.push({ key: `debt:${x.id}:${p.n}`, kind: 'parcela', dir: lent ? 'in' : 'out', title: `${x.name} (${p.n}/${x.schedule.length})`, amount: p.amount, due: p.due, ref: x.id, n: p.n, icon: x.kind === 'financiamento' ? '🏦' : '🤝', sub: lent ? 'a receber' : x.kind === 'financiamento' ? 'financiamento' : 'empréstimo' });
      }
    }
    return out.filter((i) => (!until || i.due <= until) && (!from || i.due >= from)).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  }

  // ---------------- lançamentos ----------------
  /**
   * Cria lançamento(s). opts.repeat: { mode: 'parcelado'|'fixo', times }
   * Compras no cartão parceladas viram uma parcela por fatura.
   */
  addTx(base, opts = {}) {
    const times = Math.max(1, Math.min(120, parseInt(opts.times) || 1));
    const mode = opts.mode || 'unico';
    const group = times > 1 ? uid() : null;
    const card = base.cardId ? this.card(base.cardId) : null;
    const total = r2(base.amount);
    const each = mode === 'parcelado' ? r2(Math.floor((total / times) * 100) / 100) : total;
    const created = [];
    for (let i = 0; i < times; i++) {
      let amount = each;
      if (mode === 'parcelado' && i === times - 1) amount = r2(total - each * (times - 1));
      const date = i === 0 ? base.date : addMonths(base.date, i);
      const t = {
        id: uid(), ...base, amount, date,
        paid: card ? true : i === 0 ? !!base.paid : base.type === 'transfer' ? !!base.paid : false,
        group, inst: times > 1 ? { n: i + 1, total: times, mode } : null,
        createdAt: Date.now(),
      };
      if (t.paid && !t.paidDate) t.paidDate = t.date;
      if (!t.paid) delete t.paidDate;
      if (card) t.invoice = this.invoiceFor(card, i === 0 ? base.date : addMonths(base.date, i));
      if (mode === 'parcelado' && times > 1) t.desc = `${base.desc || ''}`.trim();
      this.d.txs.push(t);
      created.push(t);
    }
    this.commit();
    return created;
  }
  updateTx(id, patch, scope = 'one') {
    const t = this.tx(id);
    if (!t) return;
    const targets = scope === 'next' && t.group ? this.d.txs.filter((x) => x.group === t.group && x.date >= t.date) : [t];
    for (const x of targets) {
      const p = { ...patch };
      if (x !== t) delete p.date; // datas das outras parcelas não mudam
      if (x !== t) delete p.paid;
      Object.assign(x, p);
      if (x.cardId && p.date) x.invoice = this.invoiceFor(this.card(x.cardId), x.date);
      if ('paid' in p) {
        if (x.paid && !x.paidDate) x.paidDate = today();
        if (!x.paid) delete x.paidDate;
      }
    }
    this.commit();
  }
  deleteTx(id, scope = 'one') {
    const t = this.tx(id);
    if (!t) return;
    let ids = [id];
    if (scope === 'next' && t.group) ids = this.d.txs.filter((x) => x.group === t.group && x.date >= t.date).map((x) => x.id);
    if (scope === 'all' && t.group) ids = this.d.txs.filter((x) => x.group === t.group).map((x) => x.id);
    // se for pagamento de parcela, desmarca a parcela
    for (const x of this.d.debts) for (const p of x.schedule) if (ids.includes(p.txId)) { p.paid = false; delete p.txId; delete p.paidDate; }
    this.d.txs = this.d.txs.filter((x) => !ids.includes(x.id));
    this.commit();
  }
  setPaid(id, paid, { date = today(), accountId, amount } = {}) {
    const t = this.tx(id);
    if (!t) return;
    t.paid = paid;
    if (paid) {
      t.paidDate = date;
      if (accountId) t.accountId = accountId;
      if (amount != null) t.amount = r2(amount);
    } else delete t.paidDate;
    this.commit();
  }

  // ---------------- faturas ----------------
  payInvoice(cardId, key, { accountId, date = today(), amount }) {
    const inv = this.invoice(cardId, key);
    this.d.txs.push({
      id: uid(), type: 'expense', kind: 'invoice', cardId, invoice: key, amount: r2(amount ?? inv.total), date, paid: true, paidDate: date,
      accountId, desc: `Pagamento fatura ${inv.card.name}`, catId: null, createdAt: Date.now(),
    });
    this.commit();
  }
  unpayInvoice(cardId, key) {
    this.d.txs = this.d.txs.filter((t) => !(t.kind === 'invoice' && t.cardId === cardId && t.invoice === key));
    this.commit();
  }
  saveCard(c) {
    if (c.id) Object.assign(this.card(c.id), c);
    else this.d.cards.push({ ...c, id: uid() });
    this.commit();
  }
  deleteCard(id) {
    this.d.txs = this.d.txs.filter((t) => t.cardId !== id);
    this.d.cards = this.d.cards.filter((c) => c.id !== id);
    this.commit();
  }

  // ---------------- empréstimos e financiamentos ----------------
  /**
   * kind: 'peguei' (devo), 'emprestei' (me devem), 'financiamento'
   * system: 'price' (parcelas iguais), 'sac' (amortização constante), 'fixa' (valor da parcela informado), 'sem' (sem juros)
   */
  static buildSchedule({ principal, rate, n, first, system, installment }) {
    const P = r2(principal), i = (Number(rate) || 0) / 100, out = [];
    n = Math.max(1, parseInt(n) || 1);
    let bal = P;
    if (system === 'fixa') {
      const pmt = r2(installment);
      const rr = DB.solveRate(P, pmt, n);
      for (let k = 1; k <= n; k++) {
        const int = r2(bal * rr);
        const am = k === n ? bal : r2(pmt - int);
        bal = r2(bal - am);
        out.push({ n: k, due: addMonths(first, k - 1), amount: k === n ? r2(am + int) : pmt, interest: int, amort: am, balance: Math.max(0, bal) });
      }
      return { schedule: out, rate: Math.round(rr * 10000) / 100 };
    }
    if (system === 'sac') {
      const am = r2(P / n);
      for (let k = 1; k <= n; k++) {
        const int = r2(bal * i);
        const a = k === n ? bal : am;
        bal = r2(bal - a);
        out.push({ n: k, due: addMonths(first, k - 1), amount: r2(a + int), interest: int, amort: a, balance: Math.max(0, bal) });
      }
      return { schedule: out, rate: Number(rate) || 0 };
    }
    // price / sem juros
    const pmt = i > 0 && system !== 'sem' ? r2((P * i) / (1 - Math.pow(1 + i, -n))) : r2(P / n);
    for (let k = 1; k <= n; k++) {
      const int = system === 'sem' ? 0 : r2(bal * i);
      const a = k === n ? bal : r2(pmt - int);
      bal = r2(bal - a);
      out.push({ n: k, due: addMonths(first, k - 1), amount: k === n ? r2(a + int) : pmt, interest: int, amort: a, balance: Math.max(0, bal) });
    }
    return { schedule: out, rate: system === 'sem' ? 0 : Number(rate) || 0 };
  }
  /** taxa mensal a partir do valor da parcela (bisseção) */
  static solveRate(P, pmt, n) {
    if (pmt * n <= P) return 0;
    let lo = 0, hi = 1;
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      const v = (P * mid) / (1 - Math.pow(1 + mid, -n));
      if (v > pmt) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }
  saveDebt(x) {
    const { schedule, rate } = DB.buildSchedule(x);
    const old = x.id ? this.debt(x.id) : null;
    if (old) {
      // preserva parcelas já pagas
      schedule.forEach((p) => {
        const o = old.schedule.find((q) => q.n === p.n);
        if (o?.paid) Object.assign(p, { paid: true, paidDate: o.paidDate, txId: o.txId, paidAmount: o.paidAmount });
      });
      Object.assign(old, x, { schedule, rateCalc: rate });
    } else {
      const pre = Math.max(0, parseInt(x.alreadyPaid) || 0);
      schedule.forEach((p) => {
        if (p.n <= pre) Object.assign(p, { paid: true, paidDate: p.due, pre: true, paidAmount: p.amount });
      });
      this.d.debts.push({ ...x, id: uid(), schedule, rateCalc: rate, createdAt: Date.now() });
    }
    this.commit();
  }
  deleteDebt(id, withTxs) {
    const x = this.debt(id);
    if (withTxs) {
      const ids = new Set(x.schedule.map((p) => p.txId).filter(Boolean));
      if (x.receivedTxId) ids.add(x.receivedTxId);
      this.d.txs = this.d.txs.filter((t) => !ids.has(t.id));
    }
    this.d.debts = this.d.debts.filter((d) => d.id !== id);
    this.commit();
  }
  payInstallment(debtId, n, { accountId, date = today(), amount }) {
    const x = this.debt(debtId);
    const p = x.schedule.find((q) => q.n === n);
    const lent = x.kind === 'emprestei';
    const type = lent ? 'income' : 'expense';
    const catName = lent ? 'Empréstimos recebidos' : x.kind === 'financiamento' ? 'Financiamentos' : 'Empréstimos';
    const t = {
      id: uid(), type, kind: 'debt', debtId, amount: r2(amount ?? p.amount), date, paid: true, paidDate: date, accountId,
      catId: this.catByName(type, catName)?.id || null, desc: `${x.name} — parcela ${n}/${x.schedule.length}`, createdAt: Date.now(),
    };
    this.d.txs.push(t);
    Object.assign(p, { paid: true, paidDate: date, txId: t.id, paidAmount: t.amount });
    this.commit();
  }
  unpayInstallment(debtId, n) {
    const x = this.debt(debtId);
    const p = x.schedule.find((q) => q.n === n);
    if (p.txId) this.d.txs = this.d.txs.filter((t) => t.id !== p.txId);
    p.paid = false;
    delete p.txId;
    delete p.paidDate;
    delete p.paidAmount;
    delete p.pre;
    this.commit();
  }
  debtSummary(x) {
    const paid = x.schedule.filter((p) => p.paid);
    const open = x.schedule.filter((p) => !p.paid);
    const total = r2(x.schedule.reduce((s, p) => s + p.amount, 0));
    return {
      total, paidCount: paid.length, openCount: open.length,
      paidValue: r2(paid.reduce((s, p) => s + (p.paidAmount ?? p.amount), 0)),
      remaining: r2(open.reduce((s, p) => s + p.amount, 0)),
      balance: open.length ? r2(open[0].balance + open[0].amort) : 0, // saldo devedor (sem juros futuros)
      interest: r2(x.schedule.reduce((s, p) => s + p.interest, 0)),
      next: open[0] || null,
      progress: x.schedule.length ? paid.length / x.schedule.length : 1,
    };
  }

  // ---------------- contas (bancos/carteiras) ----------------
  saveAccount(a) {
    if (a.id) Object.assign(this.acc(a.id), a);
    else this.d.accounts.push({ ...a, id: uid() });
    this.commit();
  }
  deleteAccount(id) {
    const used = this.d.txs.some((t) => t.accountId === id || t.toAccountId === id);
    if (used) this.acc(id).archived = true;
    else this.d.accounts = this.d.accounts.filter((a) => a.id !== id);
    this.commit();
    return used;
  }

  // ---------------- categorias ----------------
  saveCategory(c) {
    if (c.id) Object.assign(this.cat(c.id), c);
    else this.d.categories.push({ ...c, id: uid() });
    this.commit();
  }
  deleteCategory(id) {
    if (this.d.txs.some((t) => t.catId === id)) this.cat(id).archived = true;
    else this.d.categories = this.d.categories.filter((c) => c.id !== id);
    delete this.d.budgets[id];
    this.commit();
  }

  // ---------------- orçamentos ----------------
  setBudget(catId, value) {
    if (!value) delete this.d.budgets[catId];
    else this.d.budgets[catId] = r2(value);
    this.commit();
  }
  budgetStatus(k) {
    const spent = {};
    this.monthStats(k).list.filter((t) => t.type === 'expense').forEach((t) => (spent[t.catId] = r2((spent[t.catId] || 0) + t.amount)));
    return Object.entries(this.d.budgets)
      .map(([id, limit]) => ({ cat: this.cat(id), id, limit, spent: spent[id] || 0, pct: (spent[id] || 0) / limit }))
      .filter((b) => b.cat)
      .sort((a, b) => b.pct - a.pct);
  }

  // ---------------- metas ----------------
  saveGoal(g) {
    if (g.id) Object.assign(this.goal(g.id), g);
    else this.d.goals.push({ ...g, id: uid(), moves: [], createdAt: Date.now() });
    this.commit();
  }
  goalMove(id, { amount, date = today(), accountId, note }) {
    const g = this.goal(id);
    const m = { id: uid(), amount: r2(amount), date, note: note || '' };
    if (accountId) {
      const t = { id: uid(), type: amount >= 0 ? 'expense' : 'income', kind: 'goal', goalId: id, amount: Math.abs(r2(amount)), date, paid: true, paidDate: date, accountId, desc: `${amount >= 0 ? 'Guardado em' : 'Retirado de'} "${g.name}"`, createdAt: Date.now() };
      this.d.txs.push(t);
      m.txId = t.id;
    }
    g.moves.push(m);
    this.commit();
  }
  goalDeleteMove(id, moveId) {
    const g = this.goal(id);
    const m = g.moves.find((x) => x.id === moveId);
    if (m?.txId) this.d.txs = this.d.txs.filter((t) => t.id !== m.txId);
    g.moves = g.moves.filter((x) => x.id !== moveId);
    this.commit();
  }
  goalSaved(g) {
    return r2(g.moves.reduce((s, m) => s + m.amount, 0));
  }
  deleteGoal(id) {
    const g = this.goal(id);
    const ids = new Set(g.moves.map((m) => m.txId).filter(Boolean));
    this.d.txs = this.d.txs.filter((t) => !ids.has(t.id));
    this.d.goals = this.d.goals.filter((x) => x.id !== id);
    this.commit();
  }

  // ---------------- vale refeição / alimentação ----------------
  /** wallet: 'vr' (refeição) ou 'va' (alimentação). Créditos = type income, gastos = type expense. */
  valeTxs(wallet, k = null) {
    return this.d.txs.filter((t) => t.wallet === wallet && (!k || t.date.slice(0, 7) === k))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }
  /** saldo do vale: créditos já recebidos (até hoje) menos todos os gastos */
  valeBalance(wallet, upTo = today()) {
    let b = 0;
    for (const t of this.d.txs) {
      if (t.wallet !== wallet || t.date > upTo) continue;
      b += t.type === 'income' ? t.amount : -t.amount;
    }
    return r2(b);
  }
  valeMonth(wallet, k) {
    const list = this.valeTxs(wallet, k);
    const sum = (l) => r2(l.reduce((s, t) => s + t.amount, 0));
    return { list, received: sum(list.filter((t) => t.type === 'income')), spent: sum(list.filter((t) => t.type === 'expense')) };
  }
  hasVale() {
    return this.d.txs.some((t) => t.wallet);
  }

  // ---------------- gráficos ----------------
  lastMonths(n = 6) {
    const k = ym(today());
    return Array.from({ length: n }, (_, i) => shiftMonth(k, i - n + 1)).map((m) => ({ k: m, ...this.monthStats(m) }));
  }

  // ---------------- backup ----------------
  exportJSON() {
    return JSON.stringify({ app: 'minhas-financas', exportedAt: new Date().toISOString(), data: this.d }, null, 1);
  }
  importJSON(text) {
    const j = JSON.parse(text);
    const d = j.data || j;
    if (!Array.isArray(d.txs) || !Array.isArray(d.accounts)) throw new Error('Arquivo de backup inválido.');
    const keep = this.d.settings, del = this.d.deleted || {};
    this.d = { ...seed(), ...d, settings: { ...seed().settings, ...(d.settings || {}), pin: keep.pin, sync: keep.sync, theme: keep.theme } };
    this.d.deleted = { ...(d.deleted || {}), ...del };
    for (const c of SYNC_COLLS) for (const it of this.d[c]) delete this.d.deleted[it.id];
    this.commit();
  }
  reset() {
    const keep = this.d.settings, del = this.d.deleted || {};
    this.d = seed();
    this.d.settings = keep;
    this.d.deleted = del;
    // itens padrão voltam a valer mesmo se tinham sido apagados antes
    for (const c of SYNC_COLLS) for (const it of this.d[c]) delete this.d.deleted[it.id];
    this.commit();
  }
}

export const db = new DB();
export const buildSchedule = DB.buildSchedule;
