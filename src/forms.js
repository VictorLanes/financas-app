import { db } from './db.js';
import { fullPanel, actionSheet, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';
import { esc, brl, r2, today, parseMoney, brDate, addMonths } from './fmt.js';
import { buildSchedule } from './db.js';

const moneyVal = (n) => (n ? r2(n).toFixed(2).replace('.', ',') : '');
const accOpts = (sel) => db.accounts().map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.icon || '')} ${esc(a.name)}</option>`).join('');
const cardOpts = (sel) => db.d.cards.filter((c) => !c.archived).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>💳 ${esc(c.name)}</option>`).join('');

function panel(title, body, { onClose, submit = 'Salvar', extraHead = '' } = {}) {
  const p = fullPanel('form-panel', onClose);
  p.el.innerHTML = `<div class="panel">
    <header class="panel-head"><button class="icon-btn" data-x type="button">${icon('close')}</button><h2 class="grow">${esc(title)}</h2>${extraHead}</header>
    <form class="panel-body form" novalidate>${body}
      <button class="btn primary block big-btn" type="submit">${esc(submit)}</button></form></div>`;
  p.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) p.close();
  });
  // formata valores ao sair do campo
  p.el.addEventListener('focusout', (e) => {
    if (e.target.matches('[data-money]') && e.target.value) e.target.value = moneyVal(parseMoney(e.target.value));
  });
  return p;
}

const field = (label, html, cls = '') => `<label class="fld ${cls}"><span>${label}</span>${html}</label>`;
const moneyInput = (name, v, big = false, ph = '0,00') => `<div class="money-in ${big ? 'big' : ''}"><span>R$</span><input name="${name}" data-money inputmode="decimal" autocomplete="off" placeholder="${ph}" value="${moneyVal(v)}"></div>`;

function catGrid(type, sel) {
  return `<div class="cat-grid">${db.cats(type).map((c) => `<button type="button" class="cat-chip ${c.id === sel ? 'on' : ''}" data-cat="${c.id}" style="--c:${c.color}"><span>${c.icon}</span>${esc(c.name)}</button>`).join('')}</div>`;
}
function bindCatGrid(el, onPick) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.cat);
  });
}

// =====================================================================
// Lançamento (receita, despesa, compra no cartão, conta a pagar, transferência)
// =====================================================================
/**
 * preset: { type: 'expense'|'income'|'transfer', card: bool, bill: bool, date, cardId }
 */
export function txForm(preset = {}, editId = null) {
  const t = editId ? db.tx(editId) : null;
  let type = t?.type || preset.type || 'expense';
  let payWith = t ? (t.cardId ? 'card' : 'account') : preset.card ? 'card' : 'account';
  let catId = t?.catId || null;
  const isBill = !t && preset.bill;
  const hasCards = db.d.cards.some((c) => !c.archived);
  if (payWith === 'card' && !hasCards) payWith = 'account';

  const title = t ? 'Editar lançamento' : type === 'transfer' ? 'Transferência' : isBill ? 'Conta a pagar' : preset.card ? 'Compra no cartão' : type === 'income' ? 'Nova receita' : 'Nova despesa';
  const draw = () => {
    const isT = type === 'transfer';
    return `
    ${!t ? `<div class="seg full type-seg">
      <button type="button" class="${type === 'expense' ? 'on exp' : ''}" data-type="expense">Despesa</button>
      <button type="button" class="${type === 'income' ? 'on inc' : ''}" data-type="income">Receita</button>
      <button type="button" class="${type === 'transfer' ? 'on' : ''}" data-type="transfer">Transferência</button></div>` : ''}
    ${moneyInput('amount', t?.amount ?? preset.amount, true)}
    ${!isT ? field('Descrição', `<input class="input" name="desc" value="${esc(t?.desc || preset.desc || '')}" placeholder="${type === 'income' ? 'Ex.: Salário' : 'Ex.: Mercado, Conta de luz'}" autocomplete="off">`) : ''}
    ${!isT ? `<div class="fld"><span>Categoria</span>${catGrid(type, catId)}</div>` : ''}
    ${type === 'expense' && hasCards && !(t && t.kind) ? `<div class="fld"><span>Pagar com</span><div class="seg full two-seg">
        <button type="button" class="${payWith === 'account' ? 'on' : ''}" data-pay="account">${icon('wallet', 16)} Conta / dinheiro</button>
        <button type="button" class="${payWith === 'card' ? 'on' : ''}" data-pay="card">${icon('card', 16)} Cartão de crédito</button></div></div>` : ''}
    <div class="grid2">
      ${field(isT ? 'Data' : payWith === 'card' ? 'Data da compra' : 'Data / vencimento', `<input class="input" type="date" name="date" value="${t?.date || preset.date || today()}">`)}
      ${isT ? field('De', `<select class="input" name="accountId">${accOpts(t?.accountId)}</select>`)
        : payWith === 'card' ? field('Cartão', `<select class="input" name="cardId">${cardOpts(t?.cardId || preset.cardId)}</select>`)
        : field(type === 'income' ? 'Receber em' : 'Pagar com', `<select class="input" name="accountId">${accOpts(t?.accountId)}</select>`)}
      ${isT ? field('Para', `<select class="input" name="toAccountId">${accOpts(t?.toAccountId || db.accounts()[1]?.id)}</select>`) : ''}
    </div>
    ${payWith !== 'card' && !isT ? `<label class="switch-row"><span>${type === 'income' ? 'Já recebi' : 'Já paguei'}</span><input type="checkbox" name="paid" ${t ? (t.paid ? 'checked' : '') : isBill ? '' : 'checked'}></label>` : ''}
    ${!t && !isT ? `<div class="fld"><span>Repetir</span><div class="grid2">
        <select class="input" name="mode">
          <option value="unico">Não repete</option>
          <option value="parcelado" ${payWith === 'card' ? 'selected' : ''}>Parcelado (divide o valor)</option>
          <option value="fixo">Todo mês (mesmo valor)</option>
        </select>
        <div class="times"><input class="input" name="times" type="number" min="1" max="120" value="1" inputmode="numeric"><span>vezes</span></div></div>
        <small class="muted hint-times"></small></div>` : ''}
    ${t?.inst ? `<p class="muted small">Parcela ${t.inst.n} de ${t.inst.total}${t.cardId ? ' · fatura ' + t.invoice.slice(5, 7) + '/' + t.invoice.slice(0, 4) : ''}</p>` : ''}
    ${type === 'expense' && payWith !== 'card' ? field('Código de barras / PIX (opcional)', `<input class="input" name="barcode" value="${esc(t?.barcode || '')}" placeholder="Cole aqui para copiar depois" autocomplete="off">`) : ''}
    ${field('Observação', `<textarea class="input" name="notes" rows="2">${esc(t?.notes || '')}</textarea>`)}
    ${t ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir lançamento</button>` : ''}`;
  };

  const p = panel(title, '<div class="dyn"></div>');
  const form = p.el.querySelector('form');
  const dyn = p.el.querySelector('.dyn');
  const keep = () => {
    const f = new FormData(form);
    return Object.fromEntries(f);
  };
  const render = (vals = null) => {
    dyn.innerHTML = draw();
    if (vals) for (const [k, v] of Object.entries(vals)) {
      const inp = form.elements[k];
      if (!inp || ['type'].includes(k)) continue;
      if (inp.type === 'checkbox') continue;
      if (inp.tagName === 'SELECT' && ![...inp.options].some((o) => o.value === v)) continue;
      inp.value = v;
    }
    updHint();
  };
  const updHint = () => {
    const h = form.querySelector('.hint-times');
    if (!h) return;
    const n = parseInt(form.elements.times?.value) || 1;
    const mode = form.elements.mode?.value;
    const v = parseMoney(form.elements.amount.value);
    if (n <= 1 || mode === 'unico') h.textContent = '';
    else if (mode === 'parcelado') h.textContent = `${n}x de ${brl(v / n)}${payWith === 'card' ? ' — uma em cada fatura' : ' — uma por mês'}`;
    else h.textContent = `${n} lançamentos de ${brl(v)}, um por mês`;
  };
  render();
  dyn.addEventListener('input', updHint);
  dyn.addEventListener('change', updHint);
  bindCatGrid(dyn, (id) => (catId = id));
  dyn.addEventListener('click', async (e) => {
    const ty = e.target.closest('[data-type]');
    if (ty) {
      const v = keep();
      type = ty.dataset.type;
      catId = null;
      if (type !== 'expense') payWith = 'account';
      render(v);
    }
    const pw = e.target.closest('[data-pay]');
    if (pw) {
      const v = keep();
      payWith = pw.dataset.pay;
      render(v);
    }
    if (e.target.closest('[data-del]')) {
      let scope = 'one';
      if (t.group) {
        scope = await actionSheet({ title: 'Excluir', items: [{ label: 'Só este', value: 'one' }, { label: 'Este e os próximos', value: 'next' }, { label: 'Todos da série', value: 'all', danger: true }] });
        if (!scope) return;
      } else if (!(await confirmDialog('Excluir lançamento?', t.desc || '', 'Excluir'))) return;
      db.deleteTx(t.id, scope);
      toast('Excluído');
      p.close();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = keep();
    const amount = parseMoney(f.amount);
    if (!(amount > 0)) return toast('Informe o valor');
    if (!f.date) return toast('Informe a data');
    if (type === 'transfer') {
      if (f.accountId === f.toAccountId) return toast('Escolha contas diferentes');
      const data = { type, amount, date: f.date, accountId: f.accountId, toAccountId: f.toAccountId, desc: 'Transferência', paid: true, notes: f.notes || '' };
      if (t) db.updateTx(t.id, data);
      else db.addTx(data);
      toast('Transferência salva');
      return p.close();
    }
    if (!catId) return toast('Escolha a categoria');
    const data = {
      type, amount, date: f.date, desc: (f.desc || '').trim(), catId, notes: f.notes || '',
      barcode: (f.barcode || '').trim() || undefined,
    };
    if (payWith === 'card') {
      if (!f.cardId) return toast('Cadastre um cartão primeiro');
      data.cardId = f.cardId;
      data.accountId = null;
    } else {
      data.accountId = f.accountId;
      data.cardId = null;
      data.paid = !!form.elements.paid?.checked;
    }
    if (t) {
      let scope = 'one';
      if (t.group) {
        scope = await actionSheet({ title: 'Aplicar alteração em', items: [{ label: 'Só neste', value: 'one' }, { label: 'Neste e nos próximos', value: 'next' }] });
        if (!scope) return;
      }
      if (!t.cardId && data.cardId) data.invoice = db.invoiceFor(db.card(data.cardId), data.date);
      db.updateTx(t.id, data, scope);
      toast('Salvo');
    } else {
      const created = db.addTx(data, { mode: f.mode, times: f.mode === 'unico' ? 1 : f.times });
      toast(created.length > 1 ? `${created.length} lançamentos criados` : 'Lançamento salvo');
    }
    p.close();
  });
}

// =====================================================================
// Pagar / receber um item pendente
// =====================================================================
export async function payDialog(item) {
  const isIn = item.dir === 'in';
  const p = panel(isIn ? 'Confirmar recebimento' : 'Confirmar pagamento', `
    <div class="pay-head"><span class="big-emoji">${item.icon}</span><div><b>${esc(item.title)}</b><div class="muted small">Vencimento ${brDate(item.due)}</div></div></div>
    ${field('Valor', moneyInput('amount', item.amount, true))}
    <div class="grid2">
      ${field(isIn ? 'Recebido em' : 'Pago com', `<select class="input" name="accountId">${accOpts(item.kind === 'fatura' ? db.card(item.ref)?.accountId : item.kind === 'pagar' || item.kind === 'receber' ? db.tx(item.ref)?.accountId : null)}</select>`)}
      ${field('Data', `<input class="input" type="date" name="date" value="${today()}">`)}
    </div>
    ${item.kind === 'fatura' ? '<p class="muted small">Se pagar um valor diferente do total, a fatura fica marcada como paga com o valor informado.</p>' : ''}`, { submit: isIn ? 'Confirmar recebimento' : 'Confirmar pagamento' });
  const form = p.el.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const amount = parseMoney(f.amount);
    if (!(amount > 0)) return toast('Informe o valor');
    if (item.kind === 'fatura') db.payInvoice(item.ref, item.inv, { accountId: f.accountId, date: f.date, amount });
    else if (item.kind === 'parcela') db.payInstallment(item.ref, item.n, { accountId: f.accountId, date: f.date, amount });
    else db.setPaid(item.ref, true, { accountId: f.accountId, date: f.date, amount });
    toast(isIn ? 'Recebimento registrado ✓' : 'Pagamento registrado ✓');
    p.close();
  });
}

// =====================================================================
// Cartão
// =====================================================================
const CARD_COLORS = ['#7c3aed', '#1e3a8a', '#0f766e', '#be123c', '#ea580c', '#111827', '#9d174d', '#0369a1'];
export function cardForm(id) {
  const c = id ? db.card(id) : { name: '', limit: 0, closingDay: 1, dueDay: 10, color: CARD_COLORS[db.d.cards.length % CARD_COLORS.length], accountId: db.accounts()[0]?.id };
  const days = (sel) => Array.from({ length: 31 }, (_, i) => `<option ${i + 1 === +sel ? 'selected' : ''}>${i + 1}</option>`).join('');
  const p = panel(id ? 'Editar cartão' : 'Novo cartão', `
    ${field('Nome do cartão', `<input class="input" name="name" value="${esc(c.name)}" placeholder="Ex.: Nubank, Itaú Platinum" required>`)}
    ${field('Limite', moneyInput('limit', c.limit))}
    <div class="grid2">
      ${field('Dia do fechamento', `<select class="input" name="closingDay">${days(c.closingDay)}</select>`)}
      ${field('Dia do vencimento', `<select class="input" name="dueDay">${days(c.dueDay)}</select>`)}
    </div>
    <p class="muted small">Compras feitas a partir do dia do fechamento entram na fatura seguinte.</p>
    ${field('Conta usada para pagar a fatura', `<select class="input" name="accountId">${accOpts(c.accountId)}</select>`)}
    <div class="fld"><span>Cor</span><div class="color-row">${CARD_COLORS.map((col) => `<button type="button" class="swatch ${col === c.color ? 'on' : ''}" data-color="${col}" style="background:${col}"></button>`).join('')}</div></div>
    ${id ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir cartão</button>` : ''}`);
  let color = c.color;
  p.el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-color]');
    if (s) {
      color = s.dataset.color;
      p.el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === s));
    }
    if (e.target.closest('[data-del]') && (await confirmDialog('Excluir cartão?', 'Todas as compras e faturas deste cartão serão apagadas.', 'Excluir'))) {
      db.deleteCard(id);
      p.close();
    }
  });
  p.el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.name.trim()) return toast('Informe o nome');
    db.saveCard({ ...(id ? { id } : {}), name: f.name.trim(), limit: parseMoney(f.limit), closingDay: +f.closingDay, dueDay: +f.dueDay, accountId: f.accountId, color });
    toast('Cartão salvo');
    p.close();
  });
}

// =====================================================================
// Empréstimo / financiamento
// =====================================================================
export function debtForm(kindDefault, id) {
  const x = id ? db.debt(id) : { kind: kindDefault === 'financiamento' ? 'financiamento' : 'peguei', name: '', principal: 0, system: kindDefault === 'financiamento' ? 'price' : 'fixa', rate: '', n: 12, installment: 0, first: addMonths(today(), 1), alreadyPaid: 0 };
  const isFin = x.kind === 'financiamento';
  const p = panel(id ? 'Editar' : isFin ? 'Novo financiamento' : 'Novo empréstimo', `
    ${!isFin ? `<div class="seg full two-seg">
      <button type="button" class="${x.kind === 'peguei' ? 'on' : ''}" data-kind="peguei">Peguei emprestado</button>
      <button type="button" class="${x.kind === 'emprestei' ? 'on' : ''}" data-kind="emprestei">Emprestei</button></div>` : ''}
    ${field(isFin ? 'O que foi financiado' : 'Com quem / instituição', `<input class="input" name="name" value="${esc(x.name)}" placeholder="${isFin ? 'Ex.: Carro, Apartamento' : 'Ex.: Banco, Maria'}">`)}
    ${isFin ? `<div class="grid2">${field('Valor do bem', moneyInput('assetValue', x.assetValue))}${field('Entrada', moneyInput('downPayment', x.downPayment))}</div>` : ''}
    ${field(isFin ? 'Valor financiado' : 'Valor emprestado', moneyInput('principal', x.principal, true))}
    ${field('Como são as parcelas', `<select class="input" name="system">
      <option value="fixa" ${x.system === 'fixa' ? 'selected' : ''}>Sei o valor da parcela</option>
      <option value="price" ${x.system === 'price' ? 'selected' : ''}>Parcelas iguais com juros (Tabela Price)</option>
      <option value="sac" ${x.system === 'sac' ? 'selected' : ''}>Parcelas decrescentes (SAC)</option>
      <option value="sem" ${x.system === 'sem' ? 'selected' : ''}>Sem juros</option></select>`)}
    <div class="grid2">
      ${field('Nº de parcelas', `<input class="input" type="number" name="n" min="1" max="480" value="${x.n}" inputmode="numeric">`)}
      <div class="sys-fixa">${field('Valor da parcela', moneyInput('installment', x.installment))}</div>
      <div class="sys-rate">${field('Juros ao mês (%)', `<input class="input" name="rate" inputmode="decimal" value="${x.rate ?? ''}" placeholder="Ex.: 1,99">`)}</div>
    </div>
    <div class="grid2">
      ${field('<span class="first-lbl">1ª parcela vence em</span>', `<input class="input" type="date" name="first" value="${x.first}">`)}
      ${!id ? field('Parcelas já pagas', `<input class="input" type="number" name="alreadyPaid" min="0" value="0" inputmode="numeric">`) : ''}
    </div>
    <div class="preview muted small"></div>
    ${!id && !isFin ? `<label class="switch-row"><span class="lbl-txt">Lançar o valor na conta</span><input type="checkbox" name="register"></label>
      <div class="reg-acc" hidden>${field('Conta', `<select class="input" name="accountId">${accOpts()}</select>`)}</div>` : ''}
    ${field('Observação', `<textarea class="input" name="notes" rows="2">${esc(x.notes || '')}</textarea>`)}
    ${id ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir</button>` : ''}`);
  const form = p.el.querySelector('form');
  let kind = x.kind;
  const upd = () => {
    const f = Object.fromEntries(new FormData(form));
    const sys = f.system;
    p.el.querySelector('.sys-fixa').hidden = sys !== 'fixa';
    p.el.querySelector('.sys-rate').hidden = !(sys === 'price' || sys === 'sac');
    if (isFin && (f.assetValue || f.downPayment) && document.activeElement?.name !== 'principal') {
      const pv = parseMoney(f.assetValue) - parseMoney(f.downPayment);
      if (pv > 0) form.elements.principal.value = moneyVal(pv);
    }
    const reg = p.el.querySelector('.reg-acc');
    if (reg) {
      reg.hidden = !form.elements.register.checked;
      p.el.querySelector('.lbl-txt').textContent = kind === 'emprestei' ? 'Tirar o valor de uma conta' : 'Lançar o valor recebido na conta';
    }
    const pre = parseInt(f.alreadyPaid) || 0;
    const fl = p.el.querySelector('.first-lbl');
    if (fl) fl.textContent = pre > 0 ? `Próxima parcela (${pre + 1}ª) vence em` : '1ª parcela vence em';
    const P = parseMoney(form.elements.principal.value), n = parseInt(f.n) || 0;
    const prev = p.el.querySelector('.preview');
    if (!(P > 0) || !(n > 0) || (sys === 'fixa' && !(parseMoney(f.installment) > 0))) return (prev.textContent = '');
    const { schedule, rate } = buildSchedule({ principal: P, n, rate: parseMoney(f.rate), system: sys, installment: parseMoney(f.installment), first: f.first || today() });
    const total = schedule.reduce((s, q) => s + q.amount, 0);
    prev.innerHTML = `<b>${n}x</b> ${sys === 'sac' ? `de ${brl(schedule[0].amount)} até ${brl(schedule[n - 1].amount)}` : `de ${brl(schedule[0].amount)}`} · total ${brl(total)} · juros ${brl(total - P)}${sys === 'fixa' && rate ? ` · taxa ≈ ${Number(rate).toFixed(2).replace('.', ',')}% a.m.` : ''}`;
  };
  form.addEventListener('input', upd);
  form.addEventListener('change', upd);
  setTimeout(upd, 0);
  p.el.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      kind = k.dataset.kind;
      p.el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b === k));
      upd();
    }
    if (e.target.closest('[data-del]')) {
      const paidTx = x.schedule.some((q) => q.txId);
      const v = await actionSheet({ title: 'Excluir', items: [
        ...(paidTx ? [{ label: 'Excluir e apagar os pagamentos lançados', value: 'all', danger: true }] : []),
        { label: paidTx ? 'Excluir mas manter os pagamentos no extrato' : 'Excluir', value: 'keep', danger: !paidTx },
      ] });
      if (!v) return;
      db.deleteDebt(id, v === 'all');
      p.close();
      document.querySelector('.debt-detail [data-x]')?.click();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const data = {
      ...(id ? { id } : {}), kind, name: (f.name || '').trim() || (isFin ? 'Financiamento' : 'Empréstimo'),
      principal: parseMoney(f.principal), system: f.system, rate: parseMoney(f.rate), n: parseInt(f.n), installment: parseMoney(f.installment),
      first: f.first, notes: f.notes || '', alreadyPaid: parseInt(f.alreadyPaid) || 0,
    };
    // com parcelas já pagas, a data informada é a da próxima parcela
    if (!id && data.alreadyPaid > 0) data.first = addMonths(f.first, -data.alreadyPaid);
    if (isFin) Object.assign(data, { assetValue: parseMoney(f.assetValue), downPayment: parseMoney(f.downPayment) });
    if (!(data.principal > 0)) return toast('Informe o valor');
    if (!(data.n > 0)) return toast('Informe o nº de parcelas');
    if (data.system === 'fixa' && !(data.installment > 0)) return toast('Informe o valor da parcela');
    if ((data.system === 'price' || data.system === 'sac') && !(data.rate > 0)) return toast('Informe a taxa de juros');
    db.saveDebt(data);
    if (!id && f.register) {
      const lent = kind === 'emprestei';
      db.addTx({ type: lent ? 'expense' : 'income', kind: 'debt', amount: data.principal, date: today(), paid: true, accountId: f.accountId,
        catId: db.catByName(lent ? 'expense' : 'income', lent ? 'Empréstimos' : 'Empréstimos recebidos')?.id, desc: `${lent ? 'Empréstimo para' : 'Empréstimo de'} ${data.name}` });
    }
    toast('Salvo');
    p.close();
  });
}

// =====================================================================
// Conta bancária / carteira
// =====================================================================
const ACC_TYPES = [['corrente', 'Conta corrente', '🏦'], ['poupanca', 'Poupança', '🐷'], ['dinheiro', 'Dinheiro / carteira', '👛'], ['investimento', 'Investimento', '📈'], ['outra', 'Outra', '💼']];
export function accountForm(id) {
  const a = id ? db.acc(id) : { name: '', type: 'corrente', initial: 0, color: '#7c3aed', icon: '🏦' };
  const p = panel(id ? 'Editar conta' : 'Nova conta', `
    ${field('Nome', `<input class="input" name="name" value="${esc(a.name)}" placeholder="Ex.: Nubank, Caixa, Carteira">`)}
    ${field('Tipo', `<select class="input" name="type">${ACC_TYPES.map(([v, l, ic]) => `<option value="${v}" data-ic="${ic}" ${a.type === v ? 'selected' : ''}>${ic} ${l}</option>`).join('')}</select>`)}
    ${field(id ? 'Saldo inicial (antes do 1º lançamento)' : 'Saldo atual', moneyInput('initial', a.initial, false, '0,00'))}
    <p class="muted small">Pode ser negativo (ex.: -150,00 se estiver no cheque especial).</p>
    <label class="switch-row"><span>Não somar no saldo total</span><input type="checkbox" name="excludeTotal" ${a.excludeTotal ? 'checked' : ''}></label>
    ${id ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir conta</button>` : ''}`);
  p.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-del]') && (await confirmDialog('Excluir conta?', 'Se ela tiver lançamentos, será apenas arquivada.', 'Excluir'))) {
      const arch = db.deleteAccount(id);
      toast(arch ? 'Conta arquivada' : 'Conta excluída');
      p.close();
    }
  });
  p.el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.name.trim()) return toast('Informe o nome');
    const neg = String(f.initial).trim().startsWith('-');
    const ic = ACC_TYPES.find((x) => x[0] === f.type)?.[2];
    db.saveAccount({ ...(id ? { id } : {}), name: f.name.trim(), type: f.type, icon: ic, initial: (neg ? -1 : 1) * Math.abs(parseMoney(f.initial)), excludeTotal: !!f.excludeTotal });
    toast('Conta salva');
    p.close();
  });
}

// =====================================================================
// Categoria
// =====================================================================
const EMOJIS = '🍔 🛒 🏠 💡 🚗 ⛽ 🚌 💊 🏥 📚 🎉 🛍️ 💅 💇 📺 🎮 🐾 🎁 🧾 🤝 🏦 👶 👗 ✈️ 🏖️ ☕ 🍕 🍺 💪 📱 💻 🔧 🧹 💼 💰 📈 🏷️ ↩️ 💸 ❤️ ⭐ 📦'.split(' ');
const CAT_COLORS = ['#f97316', '#22c55e', '#8b5cf6', '#eab308', '#3b82f6', '#ef4444', '#06b6d4', '#ec4899', '#a855f7', '#64748b', '#0f766e', '#84cc16'];
export function categoryForm(type, id) {
  const c = id ? db.cat(id) : { name: '', icon: '📦', color: CAT_COLORS[0], type };
  let ic = c.icon, color = c.color;
  const p = panel(id ? 'Editar categoria' : 'Nova categoria', `
    ${field('Nome', `<input class="input" name="name" value="${esc(c.name)}">`)}
    <div class="fld"><span>Ícone</span><div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" class="${e === ic ? 'on' : ''}" data-ic="${e}">${e}</button>`).join('')}</div></div>
    <div class="fld"><span>Cor</span><div class="color-row">${CAT_COLORS.map((col) => `<button type="button" class="swatch ${col === color ? 'on' : ''}" data-color="${col}" style="background:${col}"></button>`).join('')}</div></div>
    ${id ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir categoria</button>` : ''}`);
  p.el.addEventListener('click', async (e) => {
    const i = e.target.closest('[data-ic]');
    if (i) {
      ic = i.dataset.ic;
      p.el.querySelectorAll('[data-ic]').forEach((x) => x.classList.toggle('on', x === i));
    }
    const s = e.target.closest('[data-color]');
    if (s) {
      color = s.dataset.color;
      p.el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === s));
    }
    if (e.target.closest('[data-del]') && (await confirmDialog('Excluir categoria?', 'Se houver lançamentos nela, ela só será escondida.', 'Excluir'))) {
      db.deleteCategory(id);
      p.close();
    }
  });
  p.el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return toast('Informe o nome');
    db.saveCategory({ ...(id ? { id } : { type }), name, icon: ic, color });
    p.close();
  });
}

// =====================================================================
// Meta
// =====================================================================
export function goalForm(id) {
  const g = id ? db.goal(id) : { name: '', target: 0, deadline: '', icon: '🎯' };
  const ICONS = '🎯 ✈️ 🏠 🚗 💍 🎓 📱 💻 🏖️ 🛟 👶 🐶 🎁 💰'.split(' ');
  let ic = g.icon;
  const p = panel(id ? 'Editar meta' : 'Nova meta', `
    ${field('Nome da meta', `<input class="input" name="name" value="${esc(g.name)}" placeholder="Ex.: Viagem, Reserva de emergência">`)}
    ${field('Quanto quer juntar', moneyInput('target', g.target, true))}
    ${field('Até quando (opcional)', `<input class="input" type="date" name="deadline" value="${g.deadline || ''}">`)}
    <div class="fld"><span>Ícone</span><div class="emoji-grid">${ICONS.map((e) => `<button type="button" class="${e === ic ? 'on' : ''}" data-ic="${e}">${e}</button>`).join('')}</div></div>
    ${id ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir meta</button>` : ''}`);
  p.el.addEventListener('click', async (e) => {
    const i = e.target.closest('[data-ic]');
    if (i) {
      ic = i.dataset.ic;
      p.el.querySelectorAll('[data-ic]').forEach((x) => x.classList.toggle('on', x === i));
    }
    if (e.target.closest('[data-del]') && (await confirmDialog('Excluir meta?', 'Os valores guardados pela conta voltam para o saldo.', 'Excluir'))) {
      db.deleteGoal(id);
      p.close();
      document.querySelector('.goal-detail [data-x]')?.click();
    }
  });
  p.el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.name.trim() || !(parseMoney(f.target) > 0)) return toast('Informe nome e valor');
    db.saveGoal({ ...(id ? { id } : {}), name: f.name.trim(), target: parseMoney(f.target), deadline: f.deadline || '', icon: ic });
    p.close();
  });
}

export function goalMoveForm(id, withdraw = false) {
  const g = db.goal(id);
  const p = panel(withdraw ? `Retirar de "${g.name}"` : `Guardar em "${g.name}"`, `
    ${field('Valor', moneyInput('amount', 0, true))}
    ${field('Data', `<input class="input" type="date" name="date" value="${today()}">`)}
    <label class="switch-row"><span>${withdraw ? 'Devolver para uma conta' : 'Tirar de uma conta'}</span><input type="checkbox" name="useAcc" checked></label>
    <div class="acc-sel">${field('Conta', `<select class="input" name="accountId">${accOpts()}</select>`)}</div>
    ${field('Observação', `<input class="input" name="note">`)}`, { submit: withdraw ? 'Retirar' : 'Guardar' });
  const form = p.el.querySelector('form');
  form.addEventListener('change', () => (p.el.querySelector('.acc-sel').hidden = !form.elements.useAcc.checked));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const v = parseMoney(f.amount);
    if (!(v > 0)) return toast('Informe o valor');
    db.goalMove(id, { amount: withdraw ? -v : v, date: f.date, accountId: f.useAcc ? f.accountId : null, note: f.note });
    p.close();
  });
}

export function budgetForm(catId) {
  const c = catId ? db.cat(catId) : null;
  let sel = catId;
  const p = panel('Orçamento mensal', `
    ${!c ? `<div class="fld"><span>Categoria</span>${catGrid('expense', null)}</div>` : `<div class="pay-head"><span class="big-emoji">${c.icon}</span><b>${esc(c.name)}</b></div>`}
    ${field('Limite por mês', moneyInput('limit', catId ? db.d.budgets[catId] : 0, true))}
    ${catId ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Remover orçamento</button>` : ''}`);
  if (!c) bindCatGrid(p.el, (id) => (sel = id));
  p.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-del]')) {
      db.setBudget(catId, 0);
      p.close();
    }
  });
  p.el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseMoney(new FormData(e.target).get('limit'));
    if (!sel) return toast('Escolha a categoria');
    if (!(v > 0)) return toast('Informe o limite');
    db.setBudget(sel, v);
    p.close();
  });
}

// =====================================================================
// Vale refeição / alimentação (crédito recebido ou gasto)
// =====================================================================
export const VALES = { vr: { nome: 'Vale Refeição', icon: '🍽️', cat: 'Alimentação' }, va: { nome: 'Vale Alimentação', icon: '🛒', cat: 'Mercado' } };

export function valeForm(preset = {}, editId = null) {
  const t = editId ? db.tx(editId) : null;
  const wallet = t?.wallet || preset.wallet || 'vr';
  const V = VALES[wallet];
  let type = t?.type || preset.type || 'expense';
  let catId = t?.catId || db.catByName('expense', V.cat)?.id || null;
  const title = t ? (type === 'income' ? 'Editar crédito' : 'Editar gasto') : `${V.icon} ${V.nome}`;
  const draw = () => `
    ${!t ? `<div class="seg full two-seg type-seg">
      <button type="button" class="${type === 'expense' ? 'on exp' : ''}" data-type="expense">Gasto</button>
      <button type="button" class="${type === 'income' ? 'on inc' : ''}" data-type="income">Saldo recebido</button></div>` : ''}
    ${moneyInput('amount', t?.amount ?? preset.amount, true)}
    ${field('Descrição', `<input class="input" name="desc" value="${esc(t?.desc || '')}" placeholder="${type === 'income' ? 'Ex.: Crédito do mês' : 'Ex.: Almoço, padaria, mercado'}" autocomplete="off">`)}
    ${type === 'expense' ? `<div class="fld"><span>Categoria</span>${catGrid('expense', catId)}</div>` : ''}
    ${field(type === 'income' ? 'Data do crédito' : 'Data', `<input class="input" type="date" name="date" value="${t?.date || today()}">`)}
    ${!t && type === 'income' ? `<div class="fld"><span>Repetir</span><div class="grid2">
        <select class="input" name="mode"><option value="unico">Não repete</option><option value="fixo">Todo mês (mesmo valor)</option></select>
        <div class="times"><input class="input" name="times" type="number" min="1" max="120" value="12" inputmode="numeric"><span>meses</span></div></div>
        <small class="muted">Os créditos futuros só entram no saldo quando chegar a data.</small></div>` : ''}
    ${field('Observação', `<textarea class="input" name="notes" rows="2">${esc(t?.notes || '')}</textarea>`)}
    ${t ? `<button type="button" class="btn danger-ghost block" data-del>${icon('trash', 18)} Excluir</button>` : ''}`;

  const p = panel(title, '<div class="dyn"></div>');
  const form = p.el.querySelector('form');
  const dyn = p.el.querySelector('.dyn');
  const render = (vals) => {
    dyn.innerHTML = draw();
    if (vals) for (const k of ['amount', 'desc', 'date', 'notes']) if (form.elements[k] && vals[k] != null) form.elements[k].value = vals[k];
  };
  render();
  bindCatGrid(dyn, (id) => (catId = id));
  dyn.addEventListener('click', async (e) => {
    const ty = e.target.closest('[data-type]');
    if (ty) {
      const v = Object.fromEntries(new FormData(form));
      type = ty.dataset.type;
      render(v);
    }
    if (e.target.closest('[data-del]')) {
      if (await excluirLancamento(t)) p.close();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const amount = parseMoney(f.amount);
    if (!(amount > 0)) return toast('Informe o valor');
    if (!f.date) return toast('Informe a data');
    const data = {
      type, amount, date: f.date, desc: (f.desc || '').trim(), notes: f.notes || '', wallet,
      catId: type === 'expense' ? catId : null, accountId: null, cardId: null, paid: true, paidDate: f.date,
    };
    if (t) {
      let scope = 'one';
      if (t.group) {
        scope = await actionSheet({ title: 'Aplicar alteração em', items: [{ label: 'Só neste', value: 'one' }, { label: 'Neste e nos próximos', value: 'next' }] });
        if (!scope) return;
      }
      db.updateTx(t.id, data, scope);
      toast('Salvo');
    } else {
      const created = db.addTx(data, { mode: f.mode || 'unico', times: f.mode === 'fixo' ? f.times : 1 });
      toast(created.length > 1 ? `${created.length} créditos programados` : type === 'income' ? 'Saldo registrado' : 'Gasto registrado');
    }
    p.close();
  });
}

/** Exclui um lançamento perguntando o escopo se for de uma série. Retorna true se excluiu. */
export async function excluirLancamento(t) {
  if (!t) return false;
  let scope = 'one';
  if (t.group) {
    scope = await actionSheet({ title: 'Excluir', items: [{ label: 'Só este', value: 'one' }, { label: 'Este e os próximos', value: 'next' }, { label: 'Todos da série', value: 'all', danger: true }] });
    if (!scope) return false;
  } else if (!(await confirmDialog('Excluir lançamento?', `${t.desc || ''} · ${brl(t.amount)}`, 'Excluir'))) return false;
  db.deleteTx(t.id, scope);
  toast('Excluído');
  return true;
}
