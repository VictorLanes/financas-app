/*
 * Tela de bloqueio: PIN (4 ou 6 dígitos) ou desenho (padrão 3x3).
 * Feita para abrir e desbloquear rápido: o teclado responde no toque (pointerdown),
 * só os pontinhos são atualizados (sem redesenhar a tela) e o PIN confere sozinho
 * ao completar os dígitos.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { db } from './db.js';
import { esc } from './fmt.js';
import { toast, actionSheet } from './ui.js';

const native = Capacitor.isNativePlatform();
const LETRAS = ['', '', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ICON_LOCK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-5 6M12 9l5 6"/></svg>';

const tick = () => native && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
const buzz = () => (native ? Haptics.notification({ type: NotificationType.Error }).catch(() => {}) : navigator.vibrate?.(180));

// ------------------------------------------------------------------ configuração

/** { type: 'pin'|'pattern', salt, hash, len } ou null. Aceita o PIN antigo (db.s.pin). */
export function lockCfg() {
  const l = db.s.lock;
  if (l && l.hash) return l;
  if (db.s.pin?.hash) return { type: 'pin', len: 4, salt: db.s.pin.salt, hash: db.s.pin.hash };
  return null;
}
export const lockEnabled = () => !!lockCfg();
export function lockLabel() {
  const c = lockCfg();
  if (!c) return 'Desativado';
  return c.type === 'pattern' ? 'Desenho' : `PIN de ${c.len || 4} dígitos`;
}

async function hashValue(v, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + v));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
const confere = async (v, c = lockCfg()) => !!c && (await hashValue(v, c.salt)) === c.hash;

// ------------------------------------------------------------------ tela

/**
 * Mostra a tela. type: 'pin' | 'pattern'. len: dígitos do PIN.
 * check(v) => true/false (ou omitido para só capturar o valor).
 * Resolve com o valor digitado/desenhado, ou null se cancelar.
 */
function lockScreen({ type = 'pin', len = 4, title, sub = '', cancel = true, check = null, clock = false, errMsg = '' }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'lk' + (clock ? ' lk-full' : '');
    const agora = new Date();
    el.innerHTML = `
      <div class="lk-glow a"></div><div class="lk-glow b"></div>
      ${clock ? `<div class="lk-top"><div class="lk-time"></div><div class="lk-date">${DIAS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}</div></div>` : '<div class="lk-top"></div>'}
      <div class="lk-mid">
        <div class="lk-badge">${ICON_LOCK}</div>
        <h2 class="lk-title">${esc(title)}</h2>
        <p class="lk-msg">${esc(sub)}</p>
        ${type === 'pin'
          ? `<div class="lk-dots">${Array.from({ length: len }, () => '<i></i>').join('')}</div>`
          : `<div class="lk-pat"><svg class="lk-lines"><polyline points=""/><line x1="0" y1="0" x2="0" y2="0"/></svg>${Array.from({ length: 9 }, (_, i) => `<span class="lk-pt" data-p="${i}"><i></i></span>`).join('')}</div>`}
      </div>
      ${type === 'pin' ? `<div class="lk-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}"><b>${n}</b><small>${LETRAS[n]}</small></button>`).join('')}
        <button class="lk-txt" data-k="c">${cancel ? 'Cancelar' : ''}</button><button data-k="0"><b>0</b><small>&nbsp;</small></button><button class="lk-txt" data-k="b" aria-label="Apagar">${ICON_BACK}</button></div>`
        : `<div class="lk-foot">${cancel ? '<button class="lk-link" data-k="c">Cancelar</button>' : ''}</div>`}`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const msgEl = el.querySelector('.lk-msg');
    const setMsg = (t, err = false) => {
      msgEl.textContent = t;
      msgEl.classList.toggle('err', err);
    };
    const timeEl = el.querySelector('.lk-time');
    const relogio = () => timeEl && (timeEl.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    relogio();
    const timer = clock ? setInterval(relogio, 5000) : 0;

    let busy = false;
    let falhas = 0;
    let bloqueadoAte = 0;
    const fechar = (v) => {
      clearInterval(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
      resolve(v);
    };
    const erro = (txt) => {
      buzz();
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake', 'bad');
      setMsg(txt, true);
      setTimeout(() => el.classList.remove('bad'), 450);
    };
    const tentar = async (v, limpar) => {
      if (!check) return fechar(v);
      busy = true;
      const ok = await check(v);
      busy = false;
      if (ok) {
        el.classList.add('good');
        return fechar(v);
      }
      falhas++;
      if (falhas >= 5) {
        bloqueadoAte = Date.now() + 30000;
        erro('Muitas tentativas. Aguarde 30 segundos.');
        setTimeout(() => setMsg(sub), 30000);
        falhas = 0;
      } else erro(errMsg || (type === 'pin' ? 'PIN incorreto' : 'Desenho incorreto'));
      setTimeout(limpar, 380);
    };

    if (type === 'pin') {
      let v = '';
      const dots = [...el.querySelectorAll('.lk-dots i')];
      const pinta = () => dots.forEach((d, i) => d.classList.toggle('on', i < v.length));
      // pointerdown: responde no toque, sem esperar soltar o dedo
      el.querySelector('.lk-pad').addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b || busy) return;
        e.preventDefault();
        const k = b.dataset.k;
        if (k === 'c') return cancel && fechar(null);
        if (Date.now() < bloqueadoAte) return;
        tick();
        if (k === 'b') v = v.slice(0, -1);
        else if (v.length < len) v += k;
        pinta();
        if (k !== 'b' && v.length === 1 && msgEl.classList.contains('err')) setMsg(sub);
        if (v.length === len) tentar(v, () => { v = ''; pinta(); });
      });
      // teclado físico (computador)
      const tecla = (e) => {
        if (!document.body.contains(el)) return document.removeEventListener('keydown', tecla);
        if (/^\d$/.test(e.key)) el.querySelector(`[data-k="${e.key}"]`)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        if (e.key === 'Backspace') el.querySelector('[data-k="b"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        if (e.key === 'Escape' && cancel) fechar(null);
      };
      document.addEventListener('keydown', tecla);
    } else {
      const pat = el.querySelector('.lk-pat');
      const pts = [...pat.querySelectorAll('.lk-pt')];
      const poly = pat.querySelector('polyline');
      const ln = pat.querySelector('line');
      const lines = pat.querySelector('.lk-lines');
      let seq = [];
      let ativo = false;
      const centro = (i) => {
        const r = pts[i].getBoundingClientRect(), base = pat.getBoundingClientRect();
        return [r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top];
      };
      const desenhar = (fx, fy) => {
        poly.setAttribute('points', seq.map((i) => centro(i).join(',')).join(' '));
        lines.classList.toggle('drag', !!(ativo && seq.length && fx != null));
        if (ativo && seq.length && fx != null) {
          const [x, y] = centro(seq[seq.length - 1]);
          ln.setAttribute('x1', x); ln.setAttribute('y1', y); ln.setAttribute('x2', fx); ln.setAttribute('y2', fy);
        } else {
          ln.setAttribute('x2', ln.getAttribute('x1'));
          ln.setAttribute('y2', ln.getAttribute('y1'));
        }
      };
      const limpar = () => {
        seq = [];
        pts.forEach((p) => p.classList.remove('on'));
        desenhar();
      };
      const adiciona = (i) => {
        if (seq.includes(i)) return;
        // passou por cima de um ponto do meio? (ex.: 0 → 2 passa pelo 1)
        if (seq.length) {
          const a = seq[seq.length - 1];
          const [ar, ac, br, bc] = [Math.floor(a / 3), a % 3, Math.floor(i / 3), i % 3];
          if ((ar + br) % 2 === 0 && (ac + bc) % 2 === 0) {
            const meio = ((ar + br) / 2) * 3 + (ac + bc) / 2;
            if (!seq.includes(meio)) { seq.push(meio); pts[meio].classList.add('on'); }
          }
        }
        seq.push(i);
        pts[i].classList.add('on');
        tick();
      };
      const acerta = (e) => {
        const base = pat.getBoundingClientRect();
        const x = e.clientX - base.left, y = e.clientY - base.top;
        const raio = base.width / 7;
        for (let i = 0; i < 9; i++) {
          const [cx, cy] = centro(i);
          if (Math.hypot(cx - x, cy - y) < raio) adiciona(i);
        }
        desenhar(x, y);
      };
      pat.addEventListener('pointerdown', (e) => {
        if (busy || Date.now() < bloqueadoAte) return;
        e.preventDefault();
        pat.setPointerCapture(e.pointerId);
        limpar();
        ativo = true;
        if (msgEl.classList.contains('err')) setMsg(sub);
        acerta(e);
      });
      pat.addEventListener('pointermove', (e) => ativo && acerta(e));
      const fim = () => {
        if (!ativo) return;
        ativo = false;
        desenhar();
        if (!seq.length) return;
        if (seq.length < 4) {
          erro('Ligue pelo menos 4 pontos');
          return setTimeout(limpar, 380);
        }
        tentar(seq.join(''), limpar);
      };
      pat.addEventListener('pointerup', fim);
      pat.addEventListener('pointercancel', fim);
      el.querySelector('[data-k="c"]')?.addEventListener('click', () => fechar(null));
    }
  });
}

// ------------------------------------------------------------------ bloquear / desbloquear

let locked = false;
let shade = null;
export async function lockNow() {
  const c = lockCfg();
  if (locked || !c) return;
  locked = true;
  hideShade();
  await lockScreen({
    type: c.type, len: c.len || 4, title: 'Minhas Finanças', clock: true, cancel: false,
    sub: c.type === 'pattern' ? 'Desenhe o padrão para entrar' : 'Digite seu PIN',
    check: (v) => confere(v, c),
  });
  locked = false;
}
export async function checkLock() {
  if (lockEnabled()) await lockNow();
}

/** cobre a tela na hora em que o app vai para segundo plano (não aparece o conteúdo nos recentes) */
export function showShade() {
  if (!lockEnabled() || shade || locked) return;
  shade = document.createElement('div');
  shade.className = 'lk lk-shade show';
  shade.innerHTML = '<div class="lk-glow a"></div><div class="lk-glow b"></div><div class="lk-mid"><div class="lk-badge">' + ICON_LOCK + '</div></div>';
  document.body.appendChild(shade);
}
export function hideShade() {
  shade?.remove();
  shade = null;
}
/** chamado ao voltar para o app: bloqueia se ficou fora mais tempo que o configurado */
export function onResume(foraMs) {
  if (!lockEnabled()) return hideShade();
  const limite = (db.s.lockAfter ?? 30) * 1000;
  if (foraMs >= limite) lockNow();
  else hideShade();
}

// ------------------------------------------------------------------ configurar

export async function setupLock() {
  const atual = lockCfg();
  if (atual) {
    const ok = await lockScreen({
      type: atual.type, len: atual.len || 4, title: 'Confirme o bloqueio atual',
      sub: atual.type === 'pattern' ? 'Desenhe o padrão atual' : 'Digite o PIN atual', check: (v) => confere(v, atual),
    });
    if (!ok) return false;
  }
  const escolha = await actionSheet({
    title: 'Como desbloquear o app?',
    items: [
      { label: 'PIN de 4 dígitos', icon: 'lock', value: 'pin4', active: atual?.type === 'pin' && (atual.len || 4) === 4 },
      { label: 'PIN de 6 dígitos', icon: 'lock', value: 'pin6', active: atual?.type === 'pin' && atual.len === 6 },
      { label: 'Desenho (padrão)', icon: 'grip', value: 'pattern', active: atual?.type === 'pattern' },
      ...(atual ? [{ divider: true }, { label: 'Desativar bloqueio', icon: 'trash', value: 'off', danger: true }] : []),
    ],
  });
  if (!escolha) return false;
  if (escolha === 'off') {
    db.setSettings({ lock: null, pin: null });
    toast('Bloqueio desativado');
    return true;
  }
  const type = escolha === 'pattern' ? 'pattern' : 'pin';
  const len = escolha === 'pin6' ? 6 : 4;
  const s1 = type === 'pin' ? `Escolha ${len} números` : 'Ligue pelo menos 4 pontos';
  const v1 = await lockScreen({ type, len, title: type === 'pin' ? 'Novo PIN' : 'Novo desenho', sub: s1 });
  if (!v1) return false;
  const v2 = await lockScreen({ type, len, title: type === 'pin' ? 'Confirme o PIN' : 'Confirme o desenho', sub: 'Repita para confirmar', errMsg: type === 'pin' ? 'Os PINs não conferem' : 'Os desenhos não conferem', check: async (v) => v === v1 });
  if (!v2) return false;
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  db.setSettings({ lock: { type, len: type === 'pin' ? len : 0, salt, hash: await hashValue(v1, salt) }, pin: null });
  toast(type === 'pin' ? 'PIN ativado ✓' : 'Desenho ativado ✓');
  return true;
}
