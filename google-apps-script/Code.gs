/**
 * Minhas Finanças: banco de dados no Google Planilhas
 * ----------------------------------------------------
 * Este script recebe e envia os dados do app (celular) e do site (computador).
 *
 * COMO INSTALAR (uma vez só):
 *  1. Crie uma planilha nova no Google Planilhas (ex.: "Minhas Finanças - Banco").
 *  2. Menu Extensões > Apps Script. Apague o que estiver lá e cole TODO este arquivo. Salve.
 *  3. Clique em Implantar > Nova implantação > (engrenagem) App da Web.
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *  4. Autorize o acesso. Copie a URL que termina em /exec.
 *  5. No site e no app: Mais > Ajustes > Sincronização > cole a URL.
 *
 * SEGURANÇA: a primeira chave de sincronização que se conectar fica registrada
 * (Projeto > Configurações do projeto > Propriedades do script > CHAVE).
 * Só quem tiver essa chave consegue ler ou gravar os dados.
 * Para trocar a chave, apague a propriedade CHAVE e conecte de novo com a nova.
 *
 * As abas "Lançamentos", "Contas", "Cartões"... são geradas automaticamente para
 * você consultar os dados. NÃO edite essas abas: elas são reescritas a cada sincronização.
 * Os dados de verdade ficam na aba "_sync" (não mexa nela).
 */

var COLLS = ['accounts', 'categories', 'txs', 'cards', 'debts', 'goals'];
var CHUNK = 45000; // limite de caracteres por célula é 50.000

function doGet() {
  return json({ ok: true, app: 'minhas-financas', msg: 'Banco de dados funcionando. Use o app para sincronizar.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var req = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var chave = props.getProperty('CHAVE');
    if (!req.key || String(req.key).length < 8) return json({ ok: false, error: 'Chave de sincronização inválida.' });
    if (!chave) {
      props.setProperty('CHAVE', String(req.key)); // primeira conexão registra a chave
      chave = String(req.key);
    }
    if (req.key !== chave) return json({ ok: false, error: 'Chave de sincronização incorreta.' });

    lock.waitLock(25000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (req.action === 'ping') {
      var d0 = readDoc(ss);
      return json({ ok: true, hasData: !!d0, sheet: ss.getName(), url: ss.getUrl() });
    }
    if (req.action === 'pull') {
      var d1 = readDoc(ss);
      return json({ ok: true, doc: d1, rev: props.getProperty('REV') || '0' });
    }
    if (req.action === 'push') {
      var current = readDoc(ss);
      var merged = mergeDocs(current, req.doc);
      writeDoc(ss, merged);
      var rev = String(Date.now());
      props.setProperty('REV', rev);
      try {
        writeReadable(ss, merged);
      } catch (err) {
        console.error(err); // as abas de consulta não podem impedir a sincronização
      }
      return json({ ok: true, doc: merged, rev: rev });
    }
    return json({ ok: false, error: 'Ação desconhecida: ' + req.action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------- armazenamento (aba _sync) ----------------
function syncSheet(ss) {
  var sh = ss.getSheetByName('_sync');
  if (!sh) {
    sh = ss.insertSheet('_sync');
    sh.getRange('A1:B1').setValues([['parte', 'dados (não editar)']]);
    sh.hideSheet();
  }
  return sh;
}
function readDoc(ss) {
  var sh = syncSheet(ss);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();
  vals.sort(function (a, b) { return a[0] - b[0]; });
  var txt = vals.map(function (r) { return r[1]; }).join('');
  if (!txt) return null;
  return JSON.parse(txt);
}
function writeDoc(ss, doc) {
  var sh = syncSheet(ss);
  var txt = JSON.stringify(doc);
  var rows = [];
  for (var i = 0; i * CHUNK < txt.length; i++) rows.push([i, txt.substr(i * CHUNK, CHUNK)]);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---------------- junção item a item (igual ao app) ----------------
function mergeDocs(a, b) {
  if (!a) return b;
  if (!b) return a;
  var deleted = {}, id;
  var da = a.deleted || {}, db = b.deleted || {};
  for (id in da) deleted[id] = da[id];
  for (id in db) if (!deleted[id] || deleted[id] < db[id]) deleted[id] = db[id];
  var out = { deleted: deleted };
  COLLS.forEach(function (c) {
    var map = {}, order = [];
    (a[c] || []).forEach(function (it) { if (!map[it.id]) order.push(it.id); map[it.id] = it; });
    (b[c] || []).forEach(function (it) {
      var cur = map[it.id];
      if (!cur) order.push(it.id);
      if (!cur || (it.u || 0) > (cur.u || 0)) map[it.id] = it;
    });
    out[c] = order.map(function (k) { return map[k]; }).filter(function (it) {
      return !(deleted[it.id] && deleted[it.id] >= (it.u || 0));
    });
  });
  var useB = (b.budgetsU || 0) > (a.budgetsU || 0);
  out.budgets = useB ? (b.budgets || {}) : (a.budgets || {});
  out.budgetsU = Math.max(a.budgetsU || 0, b.budgetsU || 0);
  var old = Date.now() - 365 * 864e5;
  for (id in out.deleted) if (out.deleted[id] < old) delete out.deleted[id];
  return out;
}

// ---------------- abas para consulta ----------------
function toDate(s) {
  if (!s) return '';
  var p = String(s).split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function writeTable(ss, name, header, rows, formats) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#6d28d9').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
    (formats || []).forEach(function (f, i) {
      if (!f) return;
      sh.getRange(2, i + 1, rows.length, 1).setNumberFormat(f === 'money' ? '"R$" #,##0.00;[Red]-"R$" #,##0.00' : f === 'date' ? 'dd/mm/yyyy' : f);
    });
  }
  try { sh.autoResizeColumns(1, header.length); } catch (e) {}
}

function writeReadable(ss, d) {
  var byId = function (list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; };
  var acc = byId(d.accounts), cat = byId(d.categories), card = byId(d.cards);
  var tipo = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
  var txs = (d.txs || []).slice().sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });

  writeTable(ss, 'Lançamentos',
    ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Cartão', 'Valor', 'Situação', 'Parcela', 'Observação'],
    txs.map(function (t) {
      var catName = t.kind === 'invoice' ? 'Pagamento de fatura' : t.kind === 'goal' ? 'Metas / ajuste' : (cat[t.catId] || {}).name || '';
      var sit = t.type === 'transfer' ? '' : t.cardId && t.kind !== 'invoice' ? 'No cartão' : t.paid ? (t.type === 'income' ? 'Recebido' : 'Pago') : 'Pendente';
      var conta = t.type === 'transfer' ? ((acc[t.accountId] || {}).name || '') + ' → ' + ((acc[t.toAccountId] || {}).name || '') : (acc[t.accountId] || {}).name || '';
      return [toDate(t.date), tipo[t.type] || t.type, t.desc || '', catName, conta, t.cardId ? (card[t.cardId] || {}).name || '' : '',
        t.type === 'expense' ? -t.amount : t.amount, sit, t.inst ? t.inst.n + '/' + t.inst.total : '', t.notes || ''];
    }), ['date', null, null, null, null, null, 'money']);

  writeTable(ss, 'Contas', ['Conta', 'Tipo', 'Saldo inicial', 'Fora do total', 'Arquivada'],
    (d.accounts || []).map(function (a) { return [a.name, a.type, a.initial || 0, a.excludeTotal ? 'sim' : '', a.archived ? 'sim' : '']; }), [null, null, 'money']);

  writeTable(ss, 'Cartões', ['Cartão', 'Limite', 'Fechamento (dia)', 'Vencimento (dia)', 'Conta de pagamento'],
    (d.cards || []).map(function (c) { return [c.name, c.limit || 0, c.closingDay, c.dueDay, (acc[c.accountId] || {}).name || '']; }), [null, 'money']);

  var kind = { peguei: 'Peguei emprestado', emprestei: 'Emprestei', financiamento: 'Financiamento' };
  var debtRows = [], instRows = [];
  (d.debts || []).forEach(function (x) {
    var paid = 0, rem = 0, np = 0;
    (x.schedule || []).forEach(function (p) {
      if (p.paid) { paid += p.paidAmount || p.amount; np++; } else rem += p.amount;
      instRows.push([x.name, p.n, toDate(p.due), p.amount, p.interest, p.amort, p.balance, p.paid ? 'Pago ' + (p.paidDate || '') : 'Em aberto']);
    });
    debtRows.push([x.name, kind[x.kind] || x.kind, x.principal, (x.schedule || []).length, np, paid, rem]);
  });
  writeTable(ss, 'Empréstimos e financiamentos', ['Nome', 'Tipo', 'Valor', 'Parcelas', 'Pagas', 'Valor pago', 'Restante'], debtRows, [null, null, 'money', null, null, 'money', 'money']);
  writeTable(ss, 'Parcelas', ['Empréstimo / financiamento', 'Nº', 'Vencimento', 'Parcela', 'Juros', 'Amortização', 'Saldo devedor', 'Situação'], instRows, [null, null, 'date', 'money', 'money', 'money', 'money']);

  writeTable(ss, 'Categorias', ['Categoria', 'Tipo', 'Ícone', 'Orçamento mensal'],
    (d.categories || []).filter(function (c) { return !c.archived; }).map(function (c) { return [c.name, c.type === 'income' ? 'Receita' : 'Despesa', c.icon || '', (d.budgets || {})[c.id] || '']; }), [null, null, null, 'money']);

  writeTable(ss, 'Metas', ['Meta', 'Objetivo', 'Guardado', 'Prazo'],
    (d.goals || []).map(function (g) {
      var s = 0; (g.moves || []).forEach(function (m) { s += m.amount; });
      return [g.name, g.target, s, toDate(g.deadline)];
    }), [null, 'money', 'money', 'date']);

  // remove a aba padrão vazia, se existir
  var p1 = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (p1 && p1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(p1);
}
