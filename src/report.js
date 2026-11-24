/*
 * Relatórios: cada aba monta um "spec" e aqui ele vira PDF (jsPDF + autoTable)
 * ou Excel formatado com tabelas (ExcelJS).
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { brl, brDate, ymd } from './fmt.js';
import { toast } from './ui.js';

const native = Capacitor.isNativePlatform();
const FOLDER = 'MinhasFinancas';

// ---------- salvar / compartilhar ----------
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function saveFile(bytes, name, mime) {
  if (!native) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
    a.download = name;
    a.click();
    return;
  }
  const data = toB64(bytes);
  let where = '';
  try {
    await Filesystem.writeFile({ path: `${FOLDER}/${name}`, data, directory: Directory.Documents, recursive: true });
    where = `Documentos/${FOLDER}`;
  } catch (e) {
    console.warn(e);
  }
  const tmp = await Filesystem.writeFile({ path: `share/${name}`, data, directory: Directory.Cache, recursive: true });
  if (where) toast(`Salvo em ${where}`);
  try {
    await Share.share({ title: name, files: [tmp.uri], dialogTitle: 'Enviar ou salvar relatório' });
  } catch {}
}

const safeName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

function fmtCell(v, type) {
  if (v == null || v === '') return '';
  if (type === 'money') return brl(v);
  if (type === 'date') return brDate(v);
  if (type === 'pct') return (v * 100).toFixed(1).replace('.', ',') + '%';
  return String(v);
}

// ---------- PDF ----------
async function toPDF(spec) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: spec.landscape ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const violet = [109, 40, 217], light = [237, 233, 254], dark = [30, 27, 46], muted = [110, 106, 130], green = [22, 163, 74], red = [220, 38, 38];

  doc.setFillColor(...violet);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(spec.title, 14, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (spec.subtitle) doc.text(spec.subtitle, 14, 21);
  doc.text(`Gerado em ${brDate(ymd())} às ${new Date().toLocaleTimeString('pt-BR').slice(0, 5)}`, W - 14, 21, { align: 'right' });

  let y = 34;
  const cards = spec.cards || [];
  if (cards.length) {
    const perRow = Math.min(4, cards.length);
    const bw = (W - 28 - (perRow - 1) * 3) / perRow;
    cards.forEach((c, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = 14 + col * (bw + 3), yy = y + row * 23;
      doc.setDrawColor(221, 214, 254);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, yy, bw, 20, 2, 2, 'FD');
      doc.setTextColor(...muted);
      doc.setFontSize(7.5);
      doc.text(c.label.toUpperCase(), x + 3.5, yy + 6);
      const col2 = c.color === 'green' ? green : c.color === 'red' ? red : dark;
      doc.setTextColor(...col2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(c.type === 'text' ? String(c.value) : brl(c.value), x + 3.5, yy + 14.5, { maxWidth: bw - 6 });
      doc.setFont('helvetica', 'normal');
    });
    y += Math.ceil(cards.length / perRow) * 23 + 6;
  }

  for (const sec of spec.sections) {
    if (y > H - 35) {
      doc.addPage();
      y = 16;
    }
    doc.setTextColor(...violet);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(sec.title, 14, y);
    const colStyles = {};
    sec.columns.forEach((c, i) => {
      if (['money', 'int', 'pct'].includes(c.type)) colStyles[i] = { halign: 'right' };
      if (c.w) colStyles[i] = { ...(colStyles[i] || {}), cellWidth: c.w };
    });
    const body = sec.rows.length
      ? sec.rows.map((r) => r.map((v, i) => {
          const c = sec.columns[i];
          const cell = { content: fmtCell(v, c.type) };
          if (c.type === 'money' && c.color && typeof v === 'number') cell.styles = { textColor: v < 0 ? red : green };
          return cell;
        }))
      : [[{ content: 'Nenhum registro', colSpan: sec.columns.length, styles: { halign: 'center', textColor: muted } }]];
    const foot = sec.total && sec.rows.length ? [sec.total.map((v, i) => ({ content: v == null ? '' : typeof v === 'number' ? fmtCell(v, sec.columns[i].type) : String(v), styles: ['money', 'int', 'pct'].includes(sec.columns[i].type) ? { halign: 'right' } : {} }))] : undefined;
    autoTable(doc, {
      startY: y + 2,
      head: [sec.columns.map((c) => c.h)],
      body,
      foot,
      showFoot: 'lastPage',
      theme: 'grid',
      margin: { left: 14, right: 14, top: 14, bottom: 16 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: dark, lineColor: [226, 222, 240], lineWidth: 0.2 },
      headStyles: { fillColor: light, textColor: violet, fontStyle: 'bold' },
      footStyles: { fillColor: light, textColor: dark, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 249, 255] },
      columnStyles: colStyles,
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`Minhas Finanças  ·  ${spec.title}`, 14, H - 7);
    doc.text(`Página ${i} de ${n}`, W - 14, H - 7, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

// ---------- Excel ----------
const MONEY_FMT = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const XL_FMT = { money: MONEY_FMT, date: 'dd/mm/yyyy', int: '0', pct: '0.0%' };

async function toXLSX(spec) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Minhas Finanças';
  wb.created = new Date();
  const VIOLET = 'FF6D28D9';

  // Resumo
  const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 22 }, { width: 18 }];
  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = spec.title;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLET } };
  ws.getRow(1).height = 28;
  ws.getCell('A1').alignment = { vertical: 'middle', indent: 1 };
  ws.getCell('A2').value = spec.subtitle || '';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF6E6A82' } };
  ws.getCell('A3').value = `Gerado em ${brDate(ymd())}`;
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF6E6A82' } };
  let r = 5;
  if (spec.cards?.length) {
    ws.addTable({
      name: 'Resumo',
      ref: `A${r}`,
      headerRow: true,
      style: { theme: 'TableStyleMedium12', showRowStripes: true },
      columns: [{ name: 'Indicador' }, { name: 'Valor' }],
      rows: spec.cards.map((c) => [c.label, c.type === 'text' ? String(c.value) : c.value]),
    });
    spec.cards.forEach((c, i) => {
      const cell = ws.getCell(`B${r + 1 + i}`);
      if (c.type !== 'text') cell.numFmt = MONEY_FMT;
      cell.font = { bold: true, color: { argb: c.color === 'red' ? 'FFDC2626' : c.color === 'green' ? 'FF16A34A' : 'FF1E1B2E' } };
    });
    r += spec.cards.length + 3;
  }
  ws.getCell(`A${r}`).value = 'Abas desta planilha:';
  ws.getCell(`A${r}`).font = { bold: true };
  spec.sections.forEach((s, i) => (ws.getCell(`A${r + 1 + i}`).value = `• ${s.title}`));

  // uma aba com tabela por seção
  const used = new Set(['Resumo']);
  spec.sections.forEach((sec, idx) => {
    let name = sec.title.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || `Tabela ${idx + 1}`;
    while (used.has(name)) name = name.slice(0, 25) + ' ' + idx;
    used.add(name);
    const sh = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
    sh.mergeCells(1, 1, 1, Math.max(2, sec.columns.length));
    sh.getCell('A1').value = sec.title;
    sh.getCell('A1').font = { bold: true, size: 13, color: { argb: VIOLET } };
    sh.getCell('A2').value = spec.subtitle || '';
    sh.getCell('A2').font = { size: 9, color: { argb: 'FF6E6A82' } };
    if (!sec.rows.length) {
      sh.getCell('A4').value = 'Nenhum registro';
      return;
    }
    const rows = sec.rows.map((row) => row.map((v, i) => {
      const t = sec.columns[i].type;
      if (t === 'date' && v) return new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)));
      if (v == null) return '';
      return v;
    }));
    const hasTotal = !!sec.total;
    sh.addTable({
      name: `T${idx + 1}_${safeName(sec.title).replace(/-/g, '_').slice(0, 20) || 'dados'}`,
      ref: 'A3',
      headerRow: true,
      totalsRow: hasTotal,
      style: { theme: 'TableStyleMedium12', showRowStripes: true },
      columns: sec.columns.map((c, i) => {
        const col = { name: c.h, filterButton: true };
        if (hasTotal) {
          if (c.type === 'money' && sec.total[i] != null && sec.total[i] !== '') col.totalsRowFunction = 'sum';
          else if (typeof sec.total[i] === 'string' && sec.total[i]) col.totalsRowLabel = sec.total[i];
          else col.totalsRowFunction = 'none';
        }
        return col;
      }),
      rows,
    });
    sec.columns.forEach((c, i) => {
      const col = sh.getColumn(i + 1);
      const maxLen = Math.max(c.h.length, ...sec.rows.map((row) => fmtCell(row[i], c.type).length));
      col.width = Math.min(48, Math.max(10, maxLen + 3));
      if (XL_FMT[c.type]) col.numFmt = XL_FMT[c.type];
      if (['money', 'int', 'pct'].includes(c.type)) col.alignment = { horizontal: 'right' };
    });
    if (hasTotal) sh.getRow(4 + rows.length).font = { bold: true };
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

/** Gera e salva/compartilha o relatório */
export async function exportReport(spec, format) {
  const base = `${safeName(spec.file || spec.title)}_${ymd()}`;
  try {
    if (format === 'pdf') await saveFile(await toPDF(spec), base + '.pdf', 'application/pdf');
    else await saveFile(await toXLSX(spec), base + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar: ' + (e.message || e));
  }
}
