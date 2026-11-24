/*
 * Gera a versão para computador (site) em um único arquivo: dist-web/index.html
 * (CSS, JavaScript e ícone embutidos). Basta arrastar para o Netlify.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const r = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', target: 'chrome100', minify: true, write: false, legalComments: 'none' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync('www/css/app.css', 'utf8');
const icon = readFileSync('docs/icon.png').toString('base64');
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#6d28d9">
<title>Minhas Finanças</title>
<link rel="icon" type="image/png" href="data:image/png;base64,${icon}">
<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${js}</script>
</body>
</html>
`;
mkdirSync('dist-web', { recursive: true });
writeFileSync('dist-web/index.html', html);
console.log('dist-web/index.html', (html.length / 1e6).toFixed(2), 'MB');
