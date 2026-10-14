'use strict';
const assert = require('node:assert/strict');
const { rundownPrintHtml } = require('../src/core/scheduling/rundown-pdf');
const source = { date: '2026-10-15', title: 'Roteiro <teste>', startTime: '23:59', items: [
    { name: 'Filme & série', duration: 180, inPoint: 30, outPoint: 90, blockLabel: '001', notes: '<img src=x onerror=alert(1)>\nRetorno' },
    { placeholder: true, liveSlot: true, name: 'Jornal', duration: 120 },
    { placeholder: true, name: '', duration: 60 }
] };
const html = rundownPrintHtml(source);
assert(html.includes('15/10/2026')); assert(html.includes('23:59:00')); assert(html.includes('00:00:00 (+1 dia)'));
assert(html.includes('00:01:00')); assert(html.includes('Filme &amp; série')); assert(html.includes('Roteiro &lt;teste&gt;'));
assert(html.includes('&lt;img')); assert(!html.includes('<img')); assert(html.includes('Ao vivo · avanço manual'));
assert(html.includes('Conteúdo a definir')); assert(html.includes('<th>Número</th>')); assert(html.includes('<th>Observação</th>'));
assert(html.includes('display:table-header-group')); assert(html.includes('white-space:pre-wrap'));
assert(rundownPrintHtml({ ...source, startTime: '00:00', items: [{ name: 'Reserva', duration: 86400 }] }).includes('24:00:00'));
const unknown = rundownPrintHtml({ ...source, items: [{ name: 'Stream', duration: null }, source.items[0]] });
assert(unknown.includes('<td class="time">—</td>'));
assert.throws(() => rundownPrintHtml({ ...source, startTime: '99:00' }), /inválido/);
console.log('RUNDOWN EXPORT: reference columns, date/clock, trimmed durations, midnight, live/unresolved labels, multiline notes and escaped HTML passed');
