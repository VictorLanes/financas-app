/*
 * Análise do mês: previsão para o fim do mês, quanto dá para gastar por dia,
 * comparação com o mês anterior, categorias que mais pesam e alertas.
 */
import { db } from './db.js';
import { r2, today, ym, monthDays, shiftMonth, parseD } from './fmt.js';

const sum = (l) => r2(l.reduce((s, t) => s + t.amount, 0));
// gastos que se repetem (parcelas, contas fixas, empréstimos) não entram no "ritmo" diário
const recorrente = (t) => !!(t.group || t.inst || t.kind === 'debt');
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function analyze(k) {
  const t = today();
  const [ini, fim] = monthDays(k);
  const dim = +fim.slice(8);
  const cur = ym(t);
  const isCur = k === cur;
  const isPast = k < cur;
  const dayNow = isCur ? +t.slice(8) : isPast ? dim : 0;
  const corte = isCur ? t : isPast ? fim : ini;

  const m = db.monthStats(k);
  const exp = m.list.filter((x) => x.type === 'expense');
  const ateHoje = sum(exp.filter((x) => x.date <= corte && (isCur || isPast)));
  const agendado = isCur ? sum(exp.filter((x) => x.date > t)) : isPast ? 0 : m.expense;
  const variavel = sum(exp.filter((x) => x.date <= corte && !recorrente(x) && (isCur || isPast)));
  const mediaDia = dayNow ? r2(ateHoje / dayNow) : 0;
  const mediaVar = dayNow ? r2(variavel / dayNow) : 0;
  const diasDepoisDeHoje = isCur ? dim - dayNow : isPast ? 0 : dim;
  const diasParaGastar = isCur ? dim - dayNow + 1 : isPast ? 0 : dim;

  // ritmo para meses futuros: média dos gastos variáveis dos 3 meses anteriores
  let ritmo = mediaVar;
  if (!isCur && !isPast) {
    const ant = [1, 2, 3].map((i) => {
      const mk = shiftMonth(cur, -i);
      const mm = db.monthStats(mk);
      return { v: sum(mm.list.filter((x) => x.type === 'expense' && !recorrente(x))), d: +monthDays(mk)[1].slice(8) };
    });
    const dias = ant.reduce((s, x) => s + x.d, 0);
    ritmo = dias ? r2(ant.reduce((s, x) => s + x.v, 0) / dias) : 0;
  }
  const projecaoDespesas = r2(m.expense + ritmo * diasDepoisDeHoje);
  const projecaoResultado = r2(m.income - projecaoDespesas);

  const meta = Number(db.s.saveTarget) || 0;
  const livre = r2(m.income - m.expense - meta);
  const porDia = diasParaGastar ? r2(livre / diasParaGastar) : 0;
  const porSemana = r2(porDia * 7);
  const gastoHoje = isCur ? sum(exp.filter((x) => x.date === t)) : 0;
  const saldoPrevisto = isCur ? r2(db.forecast(k) - mediaVar * diasDepoisDeHoje) : null;

  // mesmo período do mês anterior
  const pk = shiftMonth(k, -1);
  const pm = db.monthStats(pk);
  const pExp = pm.list.filter((x) => x.type === 'expense');
  const pAte = sum(pExp.filter((x) => +x.date.slice(8) <= (dayNow || dim)));
  const varMes = pAte > 0 && (isCur || isPast) ? (ateHoje - pAte) / pAte : null;

  // média dos 3 meses anteriores
  const tres = [1, 2, 3].map((i) => db.monthStats(shiftMonth(k, -i))).filter((x) => x.expense > 0 || x.income > 0);
  const media3 = tres.length ? r2(tres.reduce((s, x) => s + x.expense, 0) / tres.length) : 0;
  const mediaRec3 = tres.length ? r2(tres.reduce((s, x) => s + x.income, 0) / tres.length) : 0;

  // categorias
  const cats = db.byCategory(m.list);
  const pCats = new Map(db.byCategory(pm.list).map((x) => [x.id, x.v]));
  const subiu = cats.map((c) => ({ ...c, antes: pCats.get(c.id) || 0, dif: r2(c.v - (pCats.get(c.id) || 0)) }))
    .filter((c) => c.dif > 0 && c.antes > 0).sort((a, b) => b.dif - a.dif);

  const maiores = exp.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);

  // dia da semana com mais gastos (variáveis)
  const porDiaSemana = Array(7).fill(0);
  exp.filter((x) => !recorrente(x) && x.date <= corte).forEach((x) => (porDiaSemana[parseD(x.date).getDay()] += x.amount));
  const diaTop = porDiaSemana.some((v) => v > 0) ? porDiaSemana.indexOf(Math.max(...porDiaSemana)) : -1;

  const taxaEconomia = m.income > 0 ? (m.income - m.expense) / m.income : null;
  const aPagar = r2(db.dues({ until: fim }).filter((d) => d.dir === 'out' && d.due >= ini).reduce((s, d) => s + d.amount, 0));
  const vencidas = db.dues({ until: shiftDay(t, -1) }).filter((d) => d.dir === 'out');
  const aReceber = r2(db.dues({ until: fim }).filter((d) => d.dir === 'in' && d.due >= ini).reduce((s, d) => s + d.amount, 0));

  // série acumulada por dia (para o gráfico)
  const porDiaMes = Array(dim + 1).fill(0);
  exp.forEach((x) => (porDiaMes[+x.date.slice(8)] += x.amount));
  const serie = [];
  let acc = 0;
  for (let d = 1; d <= dim; d++) {
    acc += porDiaMes[d];
    serie.push(r2(acc));
  }

  // ---- alertas e dicas ----
  const alertas = [];
  const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  if (!m.income && (isCur || !isPast)) alertas.push({ t: 'info', m: 'Cadastre as receitas do mês (salário etc.) para a previsão e o limite diário ficarem certos.' });
  if (isCur || !isPast) {
    if (livre < 0) alertas.push({ t: 'ruim', m: `As despesas do mês já passam das receitas${meta ? ' (mais a meta de economia)' : ''} em ${brl(-livre)}.` });
    else if (m.income) alertas.push({ t: 'bom', m: `Para fechar o mês no azul${meta ? ' e guardar ' + brl(meta) : ''}, gaste até ${brl(porDia)} por dia (${brl(porSemana)} por semana).` });
    if (isCur && porDia > 0 && gastoHoje > porDia) alertas.push({ t: 'ruim', m: `Hoje você já gastou ${brl(gastoHoje)}, acima do limite de ${brl(porDia)} por dia.` });
    if (m.income && projecaoResultado < 0 && livre >= 0) alertas.push({ t: 'ruim', m: `No ritmo atual (${brl(ritmo)}/dia em gastos do dia a dia) o mês fecha negativo em ${brl(-projecaoResultado)}.` });
    else if (m.income && projecaoResultado >= 0 && isCur) alertas.push({ t: 'bom', m: `No ritmo atual o mês fecha com sobra de ${brl(projecaoResultado)}.` });
  }
  if (varMes != null && Math.abs(varMes) >= 0.1) {
    alertas.push(varMes > 0
      ? { t: 'ruim', m: `Você gastou ${Math.round(varMes * 100)}% a mais que no mesmo período do mês passado (${brl(ateHoje)} contra ${brl(pAte)}).` }
      : { t: 'bom', m: `Você gastou ${Math.round(-varMes * 100)}% a menos que no mesmo período do mês passado. 👏` });
  }
  if (subiu[0] && subiu[0].dif >= 50) alertas.push({ t: 'info', m: `${subiu[0].cat.icon} ${subiu[0].cat.name} subiu ${brl(subiu[0].dif)} em relação ao mês passado.` });
  for (const b of db.budgetStatus(k)) {
    if (b.pct > 1) alertas.push({ t: 'ruim', m: `Orçamento de ${b.cat.name} estourado em ${brl(b.spent - b.limit)}.` });
    else if (b.pct > 0.8) alertas.push({ t: 'info', m: `Orçamento de ${b.cat.name} em ${Math.round(b.pct * 100)}%: restam ${brl(b.limit - b.spent)}.` });
  }
  if (isCur && vencidas.length) alertas.push({ t: 'ruim', m: `${vencidas.length} conta(s) vencida(s), somando ${brl(vencidas.reduce((s, d) => s + d.amount, 0))}.` });
  if (media3 && m.expense > media3 * 1.15 && (isCur || isPast)) alertas.push({ t: 'info', m: `As despesas do mês (${brl(m.expense)}) estão acima da sua média dos últimos meses (${brl(media3)}).` });
  if (diaTop >= 0 && (isCur || isPast)) alertas.push({ t: 'info', m: `Você costuma gastar mais às ${DIAS[diaTop]}s${diaTop === 0 || diaTop === 6 ? ' (fim de semana)' : ''}.` });

  return {
    k, isCur, isPast, dim, dayNow, diasParaGastar, diasDepoisDeHoje,
    receitas: m.income, despesas: m.expense, ateHoje, agendado, mediaDia, mediaVar: ritmo, projecaoDespesas, projecaoResultado,
    meta, livre, porDia, porSemana, gastoHoje, saldoPrevisto, pAte, varMes, media3, mediaRec3, cats, subiu, maiores,
    porDiaSemana, diaTop, taxaEconomia, aPagar, aReceber, vencidas, serie, alertas,
  };
}

function shiftDay(s, n) {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Gráfico de gasto acumulado no mês, com projeção e linha das receitas. */
export function chartAcumulado(a) {
  const W = 320, H = 130, P = 6;
  const proj = [];
  if (a.isCur) {
    let v = a.serie[a.dayNow - 1] || 0;
    // projeção: acumulado real + gastos agendados nos dias que vêm + ritmo diário
    for (let d = a.dayNow; d <= a.dim; d++) {
      if (d > a.dayNow) v += (a.serie[d - 1] - a.serie[d - 2]) + a.mediaVar;
      proj.push([d, v]);
    }
  }
  const max = Math.max(1, a.receitas, ...a.serie, ...proj.map((p) => p[1]));
  const x = (d) => P + ((d - 1) / Math.max(1, a.dim - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const ate = a.isCur ? a.dayNow : a.isPast ? a.dim : 0;
  const real = a.serie.slice(0, ate).map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const pj = proj.map(([d, v]) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const rec = a.receitas ? `<line x1="${P}" x2="${W - P}" y1="${y(a.receitas)}" y2="${y(a.receitas)}" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="5 4"/>` : '';
  const ideal = a.receitas ? `<line x1="${x(1)}" y1="${y(0)}" x2="${x(a.dim)}" y2="${y(Math.max(0, a.receitas - a.meta))}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="2 4"/>` : '';
  const hoje = a.isCur ? `<line x1="${x(a.dayNow)}" x2="${x(a.dayNow)}" y1="${P}" y2="${H - P}" stroke="#94a3b8" stroke-width="1"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="line-chart" preserveAspectRatio="none">
    ${ideal}${rec}${hoje}
    ${real ? `<polyline points="${real}" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
    ${pj ? `<polyline points="${pj}" fill="none" stroke="#f43f5e" stroke-width="2" stroke-dasharray="5 4" opacity=".7"/>` : ''}
  </svg>
  <div class="chart-legend small muted"><span><i style="background:#f43f5e"></i>Gasto acumulado</span>${a.isCur ? '<span><i class="dash" style="border-color:#f43f5e"></i>Previsão</span>' : ''}${a.receitas ? '<span><i class="dash" style="border-color:#22c55e"></i>Receitas</span><span><i class="dot2"></i>Ritmo ideal</span>' : ''}</div>`;
}
