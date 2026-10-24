(function () {
'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const D = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const T = d => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mmss = s => pad(Math.floor(s / 60)) + ':' + pad(s % 60);
const DAY = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
const DFMT = d => D(d + 'T12:00:00');

const BASE = (window.API_BASE || '').replace(/\/+$/, '');
const tok = () => { try { return sessionStorage.getItem('asid') || ''; } catch (e) { return ''; } };
async function api(path, body) {
  const parts = path.split('?'), q = {};
  if (parts[1]) new URLSearchParams(parts[1]).forEach((v, k) => { q[k] = v; });
  let j;
  try {
    // plain-text POST: works from GitHub Pages without any CORS set-up
    const r = await fetch(BASE, { method: 'POST', redirect: 'follow', body: JSON.stringify({ path: parts[0], q, token: tok(), body: body === undefined ? {} : body }) });
    j = await r.json();
  } catch (e) { throw new Error('Cannot reach the server. Check your internet connection.'); }
  if (j.status === 401) { try { sessionStorage.removeItem('asid'); } catch (e) {} location.reload(); throw new Error('Session ended'); }
  if (j.status !== 200) { const e = new Error(j.error || 'Request failed'); e.status = j.status; throw e; }
  return j.data;
}

let ME, SET, tab = 'dash', poll = null, slips = [];
const app = $('app');

async function init() {
  ME = await api('/api/admin/me'); SET = await api('/api/admin/settings');
  applyTheme();
  app.innerHTML = '<div class="wrap"><div class="tabs" id="tabs"></div><div id="pane"></div></div>';
  [['dash', 'Dashboard'], ['res', 'Results'], ['qs', 'Questions'], ['set', 'Settings'], ...(ME.master ? [['master', 'Master']] : [])].forEach(([k, l]) => {
    const b = document.createElement('button'); b.textContent = l; b.dataset.k = k; b.onclick = () => go(k); $('tabs').appendChild(b);
  });
  const lo = document.createElement('button'); lo.textContent = 'Logout'; lo.style.marginLeft = 'auto';
  lo.onclick = async () => { try { await api('/api/admin/logout', {}); } catch (e) {} try { sessionStorage.removeItem('asid'); } catch (x) {} location.reload(); };
  $('tabs').appendChild(lo);
  go('dash');
}
function go(k) {
  tab = k; clearInterval(poll); poll = null;
  [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
  ({ dash: viewDash, cand: viewCand, res: viewRes, qs: viewQs, set: viewSet, master: viewMaster })[k]();
}
const msg = (el, text, cls) => { el.className = 'msg ' + (cls || ''); el.textContent = text; };

/* =============== DASHBOARD =============== */
function viewDash() {
  $('pane').innerHTML = `
  <div class="box"><h3>Test Entry Control</h3>
    <div id="entryline" style="margin-bottom:10px"></div><div id="codebox"></div>
    <div class="arow" style="align-items:center;margin-top:0">
      <span>Keep entry open for</span><input class="in" style="width:90px" type="number" id="emin" min="1" max="240" value="${SET.entry_window_min}"><span>minutes</span>
      <button class="btn grn" id="eopen">Open Entry</button><button class="btn red" id="eclose">Close Entry Now</button>
    </div>
    <p class="fine" style="margin:10px 0 0">Press Open Entry: a 5-digit Test Code appears. Write it on the board for the students in the centre. Students log in with Name, Father Name, Course and this code. When the entry window ends, nobody new can start; students already inside continue until their own timer finishes. Each press of Open Entry creates a new code.</p>
  </div>
  <div class="row2" id="counts"></div>
  <div class="box" style="margin-top:16px"><h3>Students Taking the Test Now</h3><div class="scroll" id="live"></div></div>`;
  $('eopen').onclick = async () => { await api('/api/admin/entry', { action: 'open', minutes: +$('emin').value || SET.entry_window_min }); refresh(); };
  $('eclose').onclick = async () => { await api('/api/admin/entry', { action: 'close' }); refresh(); };
  refresh(); poll = setInterval(refresh, 8000);
}
let dashOff = 0, dashUntil = 0, tickIv = null, dashCode = '';
async function refresh() {
  if (tab !== 'dash') return;
  let s; try { s = await api('/api/admin/status'); } catch (e) { return; }
  if (tab !== 'dash') return;
  dashOff = s.now - Date.now(); dashUntil = s.entryOpen ? s.entryUntil : 0; dashCode = s.entryOpen ? s.code : ''; drawEntry();
  clearInterval(tickIv); tickIv = setInterval(() => { if (tab !== 'dash') clearInterval(tickIv); else drawEntry(); }, 1000);
  const c = s.counts;
  $('counts').innerHTML = [['Logged in Today', c.registered], ['Not Started Yet', c.pending], ['Taking Test', c.running], ['Completed', c.completed]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('live').innerHTML = s.running.length ? `<table class="dt"><tr><th>Roll</th><th>Name</th><th>Father</th><th>Course</th><th>Time Left</th><th>Answered</th><th>Warnings</th><th></th></tr>` +
    s.running.map(r => `<tr><td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.courseName)}</td><td>${mmss(r.left)}</td><td>${r.answered}/${r.total}</td><td>${r.violations}</td>
    <td><button class="btn ghost sm" data-a="rel" data-id="${r.id}">Allow other device</button> <button class="btn red sm" data-a="end" data-id="${r.id}">End paper</button></td></tr>`).join('') + '</table>' : '<p class="fine">Nobody is taking the test right now.</p>';
  $('live').querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (b.dataset.a === 'end' && !confirm('End this student\'s paper now?')) return;
    try { await api(b.dataset.a === 'end' ? '/api/admin/candidates/force-end' : '/api/admin/candidates/release', { id: b.dataset.id }); refresh(); } catch (e) { alert(e.message); }
  });
}
function drawEntry() {
  const el = $('entryline'); if (!el) return;
  const left = Math.round((dashUntil - (Date.now() + dashOff)) / 1000);
  const cb = $('codebox'); if (cb) cb.innerHTML = left > 0 && dashCode ? `<div style="text-align:center;margin:6px 0 14px"><span class="fine">TEST CODE (write on the board)</span><div style="font:700 64px Consolas,monospace;letter-spacing:10px;color:var(--p)">${esc(dashCode)}</div></div>` : '';
  el.innerHTML = left > 0 ? `<span class="status on">Entry is OPEN</span> closes in <b>${mmss(left)}</b>` : '<span class="status off">Entry is CLOSED</span> students cannot start the test.';
}

/* =============== STUDENTS =============== */
function viewCand() {
  const opts = ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('pane').innerHTML = `
  <div class="box"><h3>Add Students</h3>
    <div class="row2">
      <div><label class="lbl">Test Date</label><input class="in" type="date" id="cdate" value="${ME.today}"></div>
      <div><label class="lbl">Course</label><select class="in" id="ccourse">${opts}</select></div>
    </div>
    <label class="lbl">Students (one per line: Student Name, Father Name)</label>
    <textarea class="in" id="clist" placeholder="Ali Khan, Muhammad Khan&#10;Sara Bibi, Abdul Rehman"></textarea>
    <div class="arow"><button class="btn" id="cadd">Add and Generate Passwords</button></div>
    <div id="cmsg" class="msg"></div>
  </div>
  <div class="box"><h3>Students List</h3>
    <div class="arow" style="margin:0 0 10px;align-items:center"><span>Date</span><input class="in" style="width:190px" type="date" id="fdate" value="${ME.today}"><button class="btn ghost sm" id="slipbtn">Print last generated slips</button></div>
    <div class="scroll" id="clistbox"></div>
  </div>`;
  $('cadd').onclick = async () => {
    const list = $('clist').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.indexOf(','); return i < 0 ? { name: l, father: '' } : { name: l.slice(0, i), father: l.slice(i + 1) }; });
    if (!list.length) return msg($('cmsg'), 'Write at least one student.', 'e');
    try { slips = await api('/api/admin/candidates/add', { date: $('cdate').value, course: $('ccourse').value, list }); $('clist').value = ''; msg($('cmsg'), slips.length + ' students added. Passwords are shown only once, so print the slips now.', 'g'); $('fdate').value = $('cdate').value; loadCand(); showSlips(); }
    catch (e) { msg($('cmsg'), e.message, 'e'); }
  };
  $('slipbtn').onclick = () => slips.length ? showSlips() : alert('No new passwords in this session. Use Reset Password for a student.');
  $('fdate').onchange = loadCand; loadCand();
}
async function loadCand() {
  const rows = await api('/api/admin/candidates?date=' + $('fdate').value);
  $('clistbox').innerHTML = rows.length ? `<table class="dt"><tr><th>Roll</th><th>Name</th><th>Father</th><th>Course</th><th>Status</th><th>Result</th><th></th></tr>` + rows.map(r => `<tr>
    <td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.courseName)}</td><td><span class="tag ${r.status}">${r.status}</span></td>
    <td>${r.status === 'completed' ? r.correct + '/' + r.total + ' (' + r.pct + '%)' : ''}</td>
    <td>${r.status === 'pending' ? `<button class="btn ghost sm" data-a="pw" data-id="${r.id}">Reset Password</button> <button class="btn red sm" data-a="del" data-id="${r.id}">Delete</button>` : ''}
        ${r.status === 'completed' ? `<button class="btn ghost sm" data-a="retake" data-id="${r.id}">Allow Retake</button>` : ''}</td></tr>`).join('') + '</table>' : '<p class="fine">No students for this date.</p>';
  $('clistbox').querySelectorAll('button').forEach(b => b.onclick = async () => {
    const a = b.dataset.a, id = b.dataset.id;
    try {
      if (a === 'pw') { slips = await api('/api/admin/candidates/reset-password', { id }); showSlips(); }
      else if (a === 'del') { if (confirm('Delete this student?')) { await api('/api/admin/candidates/delete', { id }); loadCand(); } }
      else if (a === 'retake') { if (confirm('The old result is archived and a new password is generated so the student can take the test again. Continue?')) { slips = await api('/api/admin/candidates/retake', { id }); showSlips(); loadCand(); } }
    } catch (e) { alert(e.message); }
  });
}
function showSlips() {
  const center = SET.center;
  $('sheet').innerHTML = `<div class="rh"><h1>${esc(center)}</h1><p>Entry Test &mdash; Student Login Slips</p></div><div class="slips">` + slips.map(s => `<div class="slip">
    <b>${esc(center)}</b><br>Name: <b>${esc(s.name)}</b><br>Father: ${esc(s.father)}<br>Course: ${esc(s.courseName)}<br>Test Date: ${esc(DFMT(s.date))}<br>
    Roll No: <b>${esc(s.roll)}</b><br>Password: <b class="pw">${esc(s.password)}</b><br><span class="fine">One attempt only. Do not share this slip.</span></div>`).join('') + '</div>';
  $('report').classList.remove('hidden');
}

/* =============== RESULTS =============== */
let RR = [], RDATE = '', PRN = null, RALL = [];
const PC = { sr: ['Sr', 4], roll: ['Roll No', 7], name: ['Student Name', 16], father: ['Father Name', 16], qual: ['Qualification', 12], course: ['Course', 13], correct: ['Correct', 7], wrong: ['Wrong', 6], na: ['N/A', 6], pct: ['%', 6], grade: ['Grade', 6], result: ['Result', 7], time: ['Time', 6], warn: ['Warnings', 7], remarks: ['Remarks', 22] };
const ALLC = Object.keys(PC), CEN = new Set(['sr', 'roll', 'correct', 'wrong', 'na', 'pct', 'grade', 'result', 'time', 'warn']);
const cellOf = (c, r, i) => ({ sr: i + 1, roll: r.roll, name: r.name, father: r.father, qual: r.qual || '', course: r.courseName, correct: r.correct, wrong: r.wrong, na: r.unanswered, pct: r.pct, grade: r.grade, result: r.pass ? 'PASS' : 'FAIL', time: mmss(r.used), warn: r.violations || 0, remarks: '' })[c];
function setPage(o) { let st = document.getElementById('pgs'); if (!st) { st = document.createElement('style'); st.id = 'pgs'; document.head.appendChild(st); } st.textContent = '@media print{@page{size:A4 ' + o + ';margin:12mm}}'; }
const cName = id => (ME.courses.find(c => c.id === id) || {}).name || id;

async function viewRes() {
  const dates = await api('/api/admin/dates'); PRN = await api('/api/admin/print');
  RDATE = RDATE || (dates[0] ? dates[0].date : ME.today);
  $('pane').innerHTML = `
  <div class="box"><h3>Results</h3>
    <div class="arow" style="margin:0;align-items:end">
      <div><label class="lbl">Test Date</label><input class="in" type="date" id="rdate" value="${RDATE}"></div>
      <div><label class="lbl">Course</label><select class="in" id="rcourse"><option value="">All courses</option>${ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="arow"><button class="btn" id="rsum">Print All Courses</button>${ME.courses.map(c => `<button class="btn grn" data-pc="${c.id}">Print: ${esc(c.name)}</button>`).join('')}<button class="btn ghost" id="rsep">All Courses (separate pages)</button></div>
    <div class="arow"><button class="btn" id="rxls">Download Excel (.xlsx)</button><button class="btn" id="rdoc">Download Word (.doc)</button><button class="btn ghost" id="rcsv">Download CSV</button><button class="btn ghost" id="rcfg">Customize Print</button></div>
    <p class="fine" style="margin:6px 0 0">Excel and Word use the course selected above (All courses = everything) and the columns chosen in Customize Print. Excel is best for editing the table, Word for editing the full printed sheet.</p>
    <div id="pcfg" class="box" style="display:none;margin-top:14px"></div>
    <p class="fine" style="margin:10px 0 0">Dates with results: ${dates.length ? dates.map(d => `<a href="#" class="dl" data-d="${d.date}">${d.date} (${d.count})</a>`).join(' &bull; ') : 'none yet'}</p>
  </div>
  <div class="box"><div id="rstats" class="row2" style="margin-bottom:14px"></div><div class="scroll" id="rtable"></div></div>`;
  document.querySelectorAll('.dl').forEach(a => a.onclick = e => { e.preventDefault(); $('rdate').value = a.dataset.d; loadRes(); });
  $('rdate').onchange = loadRes; $('rcourse').onchange = loadRes;
  $('rsum').onclick = () => printSummary(''); $('rsep').onclick = () => printSummary('*'); document.querySelectorAll('[data-pc]').forEach(b => b.onclick = () => printSummary(b.dataset.pc));
  $('rxls').onclick = () => { if (!RR.length) return alert('No results for this date.'); const f = $('rcourse').value; save(exportXlsx(RR, f ? cName(f) : 'All Courses'), 'Results_' + RDATE + (f ? '_' + cName(f).replace(/\W+/g, '_') : '') + '.xlsx'); };
  $('rdoc').onclick = () => { const f = $('rcourse').value; if (!RR.length) return alert('No results for this date.'); save(new Blob(['\uFEFF' + wordDoc(f), ], { type: 'application/msword' }), 'Results_' + RDATE + (f ? '_' + cName(f).replace(/\W+/g, '_') : '') + '.doc'); };
  $('rcsv').onclick = async () => {
    try { const r = await api('/api/admin/export?date=' + $('rdate').value); save(new Blob([r.csv], { type: 'text/csv' }), 'results_' + $('rdate').value + '.csv'); } catch (e) { alert(e.message); }
  };
  $('rcfg').onclick = () => { const p = $('pcfg'); p.style.display = p.style.display === 'none' ? '' : 'none'; if (p.style.display === '') drawPrnCfg(); };
  loadRes();
}
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function stats(rows) {
  const n = rows.length, pass = rows.filter(r => r.pass).length, avg = n ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / n * 10) / 10 : 0;
  return { n, pass, fail: n - pass, avg, hi: n ? Math.max(...rows.map(r => r.pct)) : 0, lo: n ? Math.min(...rows.map(r => r.pct)) : 0 };
}
async function loadRes() {
  RDATE = $('rdate').value;
  RALL = await api('/api/admin/results?date=' + RDATE); const fc = $('rcourse').value; RALL.sort((a, b) => a.courseName.localeCompare(b.courseName) || b.pct - a.pct || a.name.localeCompare(b.name));
  RR = fc ? RALL.filter(r => r.course === fc) : RALL.slice();
  const s = stats(RR);
  $('rstats').innerHTML = [['Appeared', s.n], ['Passed', s.pass], ['Failed', s.fail], ['Average %', s.avg], ['Highest %', s.hi], ['Lowest %', s.lo]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('rtable').innerHTML = RR.length ? `<table class="dt"><tr><th>#</th><th>Roll</th><th>Name</th><th>Father</th><th>Qualification</th><th>Course</th><th>Correct</th><th>Wrong</th><th>N/A</th><th>%</th><th>Grade</th><th>Result</th><th>Time</th><th>Warn</th><th></th></tr>` +
    RR.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.roll)}</td><td>${esc(r.name)}</td><td>${esc(r.father)}</td><td>${esc(r.qual || '')}</td><td>${esc(r.courseName)}</td><td>${r.correct}</td><td>${r.wrong}</td><td>${r.unanswered}</td><td>${r.pct}</td><td>${r.grade}</td>
    <td><span class="tag ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span></td><td>${mmss(r.used)}</td><td>${r.violations || ''}</td><td><button class="btn ghost sm" data-id="${r.id}">Detail</button> <button class="btn ghost sm" data-rt="${r.id}">Retake</button></td></tr>`).join('') + '</table>' : '<p class="fine">No completed tests for this date.</p>';
  $('rtable').querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (b.dataset.rt) { if (!confirm('Allow this student to take the test again? The old result is archived and removed from this list.')) return; try { await api('/api/admin/candidates/retake', { id: b.dataset.rt }); loadRes(); } catch (e) { alert(e.message); } }
    else detail(b.dataset.id);
  });
}

/* ----- print template (saved per centre) ----- */
function drawPrnCfg() {
  const P = PRN, order = [...P.cols, ...ALLC.filter(c => !P.cols.includes(c))], sel = (id, v, opts) => `<select class="in" id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('pcfg').innerHTML = `<h3>Customize Print / Export</h3>
  <p class="fine">Tick the columns you want and use the arrows to change their order. Saved for this centre; used by Print, Excel and Word.</p>
  <ul class="cols">${order.map(c => `<li data-c="${c}"><input type="checkbox" ${P.cols.includes(c) ? 'checked' : ''}><span style="flex:1">${PC[c][0] === '%' ? '% (Percentage)' : PC[c][0]}</span><button class="btn ghost sm" data-m="-1">&uarr;</button><button class="btn ghost sm" data-m="1">&darr;</button></li>`).join('')}</ul>
  <div class="row2">
   <div><label class="lbl">Heading (instead of "Entry Test Result Summary")</label><input class="in" id="pc_title" maxlength="80" value="${esc(P.title)}" placeholder="Entry Test Result Summary"></div>
   <div><label class="lbl">Page</label>${sel('pc_orient', P.orient, [['portrait', 'Portrait'], ['landscape', 'Landscape']])}</div>
   <div><label class="lbl">Text size</label>${sel('pc_font', P.font, [['auto', 'Automatic'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}</div>
   <div><label class="lbl">Row height</label>${sel('pc_rowH', P.rowH, [['compact', 'Compact'], ['normal', 'Normal'], ['tall', 'Tall (more writing space)']])}</div>
   <div><label class="lbl">Remarks column width</label>${sel('pc_remW', P.remarksW, [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']])}</div>
   <div><label class="lbl">Left signature</label><input class="in" id="pc_left" maxlength="40" value="${esc(P.left)}"></div>
   <div><label class="lbl">Middle signature (optional)</label><input class="in" id="pc_mid" maxlength="40" value="${esc(P.mid)}"></div>
   <div><label class="lbl">Right signature</label><input class="in" id="pc_right" maxlength="40" value="${esc(P.right)}"></div>
  </div>
  <label class="lbl">Note under the table (optional)</label><input class="in" id="pc_note" maxlength="160" value="${esc(P.note)}" placeholder="e.g. Interviews will be held on ...">
  <div class="arow"><label><input type="checkbox" id="pc_stats" ${P.stats ? 'checked' : ''}> Show summary box</label><label><input type="checkbox" id="pc_per" ${P.per ? 'checked' : ''}> Show per-course line (All Courses print)</label></div>
  <div class="arow"><button class="btn" id="pc_save">Save</button><button class="btn ghost" id="pc_reset">Reset to default</button></div><div id="pc_msg" class="msg"></div>`;
  $('pcfg').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const li = b.closest('li'), t = +b.dataset.m < 0 ? li.previousElementSibling : li.nextElementSibling; if (!t) return; t.parentNode.insertBefore(li, +b.dataset.m < 0 ? t : t.nextSibling); });
  $('pc_save').onclick = async () => {
    try { PRN = await api('/api/admin/print', { cols: [...$('pcfg').querySelectorAll('li')].filter(li => li.querySelector('input').checked).map(li => li.dataset.c), title: $('pc_title').value, orient: $('pc_orient').value, font: $('pc_font').value, rowH: $('pc_rowH').value, remarksW: $('pc_remW').value, left: $('pc_left').value, mid: $('pc_mid').value, right: $('pc_right').value, note: $('pc_note').value, stats: $('pc_stats').checked, per: $('pc_per').checked }); msg($('pc_msg'), 'Saved. Use Print, Excel or Word now.', 'g'); }
    catch (e) { msg($('pc_msg'), e.message, 'e'); }
  };
  $('pc_reset').onclick = async () => { PRN = await api('/api/admin/print/reset', {}); drawPrnCfg(); msg($('pc_msg'), 'Default layout restored.', 'g'); };
}

/* ----- the printed summary sheet ----- */
function sumPage(rows, label, perLine, last) {
  const P = PRN, n = rows.length, base = n <= 25 ? 13 : n <= 40 ? 11 : n <= 55 ? 9.5 : n <= 75 ? 8.2 : 7;
  const fs = Math.min(16, Math.round(base * ({ auto: 1, small: .85, medium: 1.1, large: 1.25 }[P.font] || 1) * 10) / 10), s = stats(rows), cc = 'text-align:center', hasRem = P.cols.includes('remarks');
  const wt = c => c === 'remarks' ? { narrow: 14, normal: 22, wide: 34 }[P.remarksW] || 22 : PC[c][1], tot = P.cols.reduce((a, c) => a + wt(c), 0), hm = { compact: .75, normal: 1, tall: 1.4 }[P.rowH] || 1;
  const rh = Math.round(hasRem ? Math.max(fs * 1.9, Math.min(fs * 3.4, 700 / (n + 1)) * hm) : fs * 1.9 * hm);
  const per = perLine && P.per ? ME.courses.map(c => { const x = rows.filter(r => r.course === c.id); return x.length ? `${esc(c.name)}: ${x.length} appeared, ${x.filter(r => r.pass).length} passed` : ''; }).filter(Boolean).join(' &nbsp;|&nbsp; ') : '';
  const sign = [P.left, P.mid, P.right].filter(Boolean);
  return `<div class="sum" style="font-size:${fs}px;${last ? '' : 'page-break-after:always;margin-bottom:30px'}">
  <div class="rh" style="padding-bottom:8px;margin-bottom:10px"><h1 style="font-size:${fs + 8}px">${esc(SET.center)}</h1><p style="font-size:${fs + 1}px">${esc(P.title || 'Entry Test Result Summary')} &mdash; ${esc(label)}<br><b>Test Date: ${esc(DFMT(RDATE))} (${DAY(RDATE)})</b></p></div>
  ${P.stats ? `<table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${[['Appeared', s.n], ['Passed', s.pass], ['Failed', s.fail], ['Average %', s.avg], ['Highest %', s.hi], ['Lowest %', s.lo]].map(([l, v]) => `<td style="${cc}"><b style="font-size:${fs + 5}px">${v}</b><br>${l}</td>`).join('')}</tr></table>` : ''}
  ${per ? `<div style="margin-bottom:6px">${per}</div>` : ''}
  <table style="width:100%;border-collapse:collapse;table-layout:fixed"><colgroup>${P.cols.map(c => `<col style="width:${(wt(c) / tot * 100).toFixed(1)}%">`).join('')}</colgroup>
  <tr>${P.cols.map(c => `<th>${PC[c][0]}</th>`).join('')}</tr>` +
    rows.map((r, i) => `<tr style="height:${rh}px">${P.cols.map(c => { const v = cellOf(c, r, i); return `<td${CEN.has(c) ? ` style="${cc}"` : ''}>${c === 'result' ? `<b>${v}</b>` : esc(v)}</td>`; }).join('')}</tr>`).join('') +
    `</table>${P.note ? `<div style="margin-top:8px">${esc(P.note)}</div>` : ''}<div class="rf" style="font-size:${Math.max(7, fs - 2)}px">Passing percentage ${SET.pass_pct}% &bull; Printed on ${D(Date.now())} ${T(Date.now())}</div>
  ${sign.length ? `<table style="width:100%;border-collapse:collapse;margin-top:26px"><tr>${sign.map(t => `<td style="border:0;width:${(100 / sign.length).toFixed(1)}%;text-align:center;padding:0 14px"><div style="border-top:1px solid #333;padding-top:5px">${esc(t)}</div></td>`).join('')}</tr></table>` : ''}</div>`;
}
/* sel: '' = all courses together, course id = that course only, '*' = every course on its own page */
function sheetHtml(sel) {
  const groups = sel === '*' ? ME.courses.map(c => [c.name, RALL.filter(r => r.course === c.id), false]).filter(g => g[1].length)
    : sel ? [[cName(sel), RALL.filter(r => r.course === sel), false]] : [['All Courses', RALL, true]];
  if (!groups.length || !groups[0][1].length) return '';
  return groups.map((g, i) => sumPage(g[1], g[0], g[2], i === groups.length - 1)).join('');
}
function printSummary(sel) {
  const h = sheetHtml(sel); if (!h) return alert('No results for this date.');
  setPage(PRN.orient); $('sheet').innerHTML = h; $('report').classList.remove('hidden');
}

/* ----- Word (.doc) and Excel (.xlsx) downloads ----- */
function wordDoc(sel) {
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Results</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]--><style>@page{size:A4 ' + PRN.orient + ';margin:12mm}body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #777;padding:3px 6px;vertical-align:middle}th{background:#e9e9f2}h1{font-size:20px;margin:0}.rh{text-align:center;border-bottom:3px double #000;margin-bottom:10px}.rf{text-align:center;color:#555;margin-top:10px}</style></head><body>' + sheetHtml(sel) + '</body></html>';
}
function zipStore(files, mime) {
  const te = new TextEncoder(), parts = [], cen = []; let off = 0;
  const T0 = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = u => { let c = -1; for (let i = 0; i < u.length; i++) c = T0[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  files.forEach(([name, text]) => {
    const nb = te.encode(name), d = te.encode(text), cr = crc(d), lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, cr, true); lh.setUint32(18, d.length, true); lh.setUint32(22, d.length, true); lh.setUint16(26, nb.length, true);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, cr, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nb, d); cen.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + d.length;
  });
  const cl = cen.reduce((a, x) => a + x.length, 0), en = new DataView(new ArrayBuffer(22));
  en.setUint32(0, 0x06054b50, true); en.setUint16(8, files.length, true); en.setUint16(10, files.length, true); en.setUint32(12, cl, true); en.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(en.buffer)], { type: mime });
}
function exportXlsx(rows, label) {
  const P = PRN, cols = P.cols, hasRem = cols.includes('remarks'), X = v => String(v).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const L = i => { let s = '', n = i + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const c = (ref, v, st) => v === '' ? `<c r="${ref}" s="${st}"/>` : typeof v === 'number' ? `<c r="${ref}" s="${st}"><v>${v}</v></c>` : `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${X(v)}</t></is></c>`;
  let r = 0, x = '';
  [[SET.center, 1], [(P.title || 'Entry Test Result Summary') + ' - ' + label, 5], ['Test Date: ' + DFMT(RDATE) + ' (' + DAY(RDATE) + ')', 5]].forEach(([t, st]) => { r++; x += `<row r="${r}">${c('A' + r, t, st)}</row>`; });
  r += 2; x += `<row r="${r}" ht="22" customHeight="1">${cols.map((k, i) => c(L(i) + r, PC[k][0], 2)).join('')}</row>`;
  rows.forEach((row, ri) => { r++; x += `<row r="${r}" ht="${hasRem ? 30 : 18}" customHeight="1">${cols.map((k, i) => c(L(i) + r, cellOf(k, row, ri), CEN.has(k) ? 4 : 3)).join('')}</row>`; });
  const W = k => k === 'remarks' ? { narrow: 14, normal: 22, wide: 34 }[P.remarksW] * 1.4 : Math.max(6, PC[k][1] * 1.6);
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const sheet = H + `<worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><cols>${cols.map((k, i) => `<col min="${i + 1}" max="${i + 1}" width="${W(k).toFixed(1)}" customWidth="1"/>`).join('')}</cols><sheetData>${x}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${P.orient}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = H + `<styleSheet xmlns="${NS}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4E3F2"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF777777"/></left><right style="thin"><color rgb="FF777777"/></right><top style="thin"><color rgb="FF777777"/></top><bottom style="thin"><color rgb="FF777777"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const R = 'http://schemas.openxmlformats.org/package/2006/relationships', OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zipStore([
    ['[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', H + `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', H + `<workbook xmlns="${NS}" xmlns:r="${OD}"><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', H + `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${OD}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OD}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet], ['xl/styles.xml', styles]], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
async function detail(id) { setPage('portrait');
  const r = await api('/api/admin/result/' + id), N = r.total;
  const reasons = { submitted: 'Submitted by student', time: 'Time over (auto)', violations: 'Auto-ended (too many warnings)', admin: 'Ended by admin' };
  const segs = [[r.correct, '#0b9f6e'], [r.wrong, '#e0445a'], [r.unanswered, '#9aa5b8']], R = 54, C = 2 * Math.PI * R; let off = 0;
  const arcs = segs.map(([v, col]) => { const l = v / N * C, s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += l; return s; }).join('');
  const vl = r.violationLog.length ? r.violationLog.map(v => T(v.t) + ' (' + esc(v.type) + ')').join(', ') : 'None';
  $('sheet').innerHTML = `
  <div class="rh"><h1>${esc(SET.center)}</h1><p>Entry Test Detailed Result &mdash; ${esc(r.course)}</p></div>
  <table class="info">
   <tr><td>Student Name</td><td>${esc(r.name)}</td><td>Father Name</td><td>${esc(r.father)}</td></tr>
   <tr><td>Course</td><td>${esc(r.course)}</td><td>Roll No.</td><td>${esc(r.roll)}</td></tr>
   <tr><td>Qualification</td><td colspan="3">${esc(r.qual || '-')}</td></tr>
   <tr><td>Test Date</td><td>${esc(DFMT(r.date))}</td><td>Day</td><td>${DAY(r.date)}</td></tr>
   <tr><td>Start Time</td><td>${T(r.startedAt)}</td><td>End Time</td><td>${T(r.finishedAt)}</td></tr>
   <tr><td>Time Allowed</td><td>${Math.round(r.durationSec / 60)} minutes</td><td>Time Used</td><td>${mmss(r.used)} (mm:ss)</td></tr>
   <tr><td>Ended By</td><td colspan="3">${esc(reasons[r.reason] || r.reason)}</td></tr>
   <tr><td>Warnings</td><td colspan="3">${r.violations} &mdash; ${vl}</td></tr>
  </table>
  <div class="score"><div><b>${N}</b><span>Total Marks</span></div><div><b>${r.correct}</b><span>Obtained Marks</span></div><div><b>${r.pct}%</b><span>Percentage</span></div><div><b>${r.grade}</b><span>Grade</span></div></div>
  <div class="res ${r.pass ? 'p' : 'f'}">Result: ${r.pass ? 'PASS' : 'FAIL'} &nbsp;(Correct ${r.correct}, Wrong ${r.wrong}, Not attempted ${r.unanswered} &bull; Passing ${r.passPct}%)</div>
  <h2 style="text-align:left;font-size:16px">Question-wise Review</h2>
  <table class="rv" style="width:100%;border-collapse:collapse"><tr><th>#</th><th>Question</th><th>Student Answer</th><th>Correct Answer</th><th></th></tr>` +
    r.review.map((q, i) => { const ok = q.chosen === q.a; return `<tr><td>${i + 1}</td><td>${esc(q.q)}</td><td>${q.chosen >= 0 ? 'ABCD'[q.chosen] + '. ' + esc(q.o[q.chosen]) : '<i>Not attempted</i>'}</td><td>${'ABCD'[q.a]}. ${esc(q.o[q.a])}</td><td class="${ok ? 'ok' : 'no'}">${ok ? '&#10003;' : '&#10007;'}</td></tr>`; }).join('') +
    `</table><div class="rf">Printed on ${D(Date.now())} at ${T(Date.now())} &bull; Computer generated report</div>`;
  $('report').classList.remove('hidden');
}
$('rclose').onclick = () => $('report').classList.add('hidden'); $('prt').onclick = () => window.print();

/* =============== QUESTIONS =============== */
let pending = null;
function viewQs() {
  $('pane').innerHTML = `
  <div class="box"><h3>Upload MCQs</h3>
   <ol class="rules" style="margin-top:0">
    <li>Click "Download Template" and open it in Microsoft Excel. Row 1 is the heading row. Start your MCQs from row 2.</li>
    <li>Use exactly 6 columns: A = Question, B = Option A, C = Option B, D = Option C, E = Option D, F = Correct Answer (one letter: A, B, C or D).</li>
    <li>Every question needs all 4 options. No empty cells and no blank rows. Save as .xlsx or .csv (only the first sheet is read).</li>
    <li>There is no fixed limit: upload as many questions as you like (up to 3000). Every uploaded question is used in every paper, in random order.</li>
    <li>Choose the course and file, press Check File, then Save Questions. Saved questions replace the old questions of that course.</li>
   </ol>
   <div class="row2"><div><label class="lbl">Course</label><select class="in" id="qcourse">${ME.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><div class="fine" id="qcount" style="margin-top:6px"></div></div>
   <div><label class="lbl">Excel (.xlsx) or CSV file</label><input class="in" type="file" id="qfile" accept=".xlsx,.csv"></div></div>
   <div class="arow"><button class="btn" id="qcheck">Check File</button><button class="btn grn" id="qsave" disabled>Save Questions</button><button class="btn ghost" id="qtpl">Download Template</button><button class="btn ghost" id="qreset">Restore Default</button></div>
   <div id="qmsg" class="msg"></div>
  </div>
  <div class="box"><h3>Current Questions (admin view only)</h3><div class="scroll" id="qlist"></div></div>`;
  $('qcourse').onchange = () => { pending = null; $('qsave').disabled = true; $('qmsg').textContent = ''; loadQs(); };
  $('qcheck').onclick = checkFile; $('qsave').onclick = saveQs; $('qtpl').onclick = tpl;
  $('qreset').onclick = async () => { if (!confirm('Replace this course\'s questions with the built-in sample set (10 questions)?')) return; try { await api('/api/admin/questions/reset', { course: $('qcourse').value }); msg($('qmsg'), 'Sample questions restored.', 'g'); loadQs(); } catch (e) { msg($('qmsg'), e.message, 'e'); } };
  loadQs();
}
async function loadQs() {
  const qs = await api('/api/admin/questions?course=' + $('qcourse').value);
  $('qcount').textContent = 'Saved questions for this course: ' + qs.length;
  $('qlist').innerHTML = `<table class="dt"><tr><th>#</th><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Ans</th></tr>` + qs.map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.q)}</td>${q.o.map(o => `<td>${esc(o)}</td>`).join('')}<td><b>${'ABCD'[q.a]}</b></td></tr>`).join('') + '</table>';
}
function tpl() {
  const t = 'Question,Option A,Option B,Option C,Option D,Correct Answer\nWhat does CPU stand for?,Central Process Unit,Central Processing Unit,Computer Personal Unit,Control Program Unit,B\nWhich of these is an input device?,Monitor,Printer,Keyboard,Speaker,C\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + t], { type: 'text/csv' })); a.download = 'MCQ_Template.csv'; a.click();
}
/* file parsing (runs in the admin's browser; the server validates again) */
function csv(t) { t = t.replace(/^\uFEFF/, ''); const l0 = t.split('\n')[0]; const d = (l0.match(/;/g) || []).length > (l0.match(/,/g) || []).length ? ';' : ','; const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === d) { r.push(f); f = ''; } else if (ch === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (ch !== '\r') f += ch; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows; }
async function inflate(u8) { const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function unzip(buf) { const dv = new DataView(buf), u = new Uint8Array(buf); let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw Error('Not a valid .xlsx file.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}, td = new TextDecoder();
  for (let i = 0; i < n; i++) { const m = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    if (!/^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(name)) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u.subarray(ds, ds + cs); out[name] = td.decode(m === 0 ? raw : await inflate(raw)); } return out; }
function xrows(f) { const dp = new DOMParser(), ss = [];
  if (f['xl/sharedStrings.xml']) [...dp.parseFromString(f['xl/sharedStrings.xml'], 'text/xml').getElementsByTagName('si')].forEach(si => ss.push([...si.getElementsByTagName('t')].map(x => x.textContent).join('')));
  const k = Object.keys(f).filter(x => x.includes('worksheets')).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]; if (!k) throw Error('No worksheet found.');
  const col = r => { let n = 0; for (const ch of r.replace(/\d/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return [...dp.parseFromString(f[k], 'text/xml').getElementsByTagName('row')].map(r => { const a = [];
    for (const c of r.getElementsByTagName('c')) { const t = c.getAttribute('t'), ve = c.getElementsByTagName('v')[0]; let v = '';
      if (t === 's') v = ss[+ve.textContent]; else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); else if (ve) v = ve.textContent; a[col(c.getAttribute('r'))] = v; }
    return Array.from(a, x => x == null ? '' : x); }); }
function toQs(rows) { const qs = [], er = [];
  rows.forEach((r, i) => { r = Array.from({ length: 6 }, (_, j) => String(r[j] == null ? '' : r[j]).trim()); if (r.every(x => !x)) return; if (i === 0 && /question/i.test(r[0])) return;
    const [q, a, b, c, d, k] = r, n = i + 1; if (!q || !a || !b || !c || !d) { er.push('Row ' + n + ': the question or one of the 4 options is empty.'); return; }
    let x = 'ABCD'.indexOf(k.toUpperCase()); if (k.length !== 1) x = -1; if (x < 0 && /^[1-4]$/.test(k)) x = +k - 1;
    if (x < 0) { er.push('Row ' + n + ': Correct Answer must be A, B, C or D (found "' + k + '").'); return; }
    qs.push({ q, o: [a, b, c, d], a: x }); });
  if (!qs.length && !er.length) er.push('No questions found in the file.'); return { qs, er }; }
async function checkFile() {
  pending = null; $('qsave').disabled = true; const f = $('qfile').files[0]; if (!f) return msg($('qmsg'), 'Please choose a file first.', 'e');
  try {
    const rows = /\.xlsx$/i.test(f.name) ? xrows(await unzip(await f.arrayBuffer())) : csv(await f.text()); const { qs, er } = toQs(rows);
    if (er.length) { $('qmsg').className = 'msg e'; $('qmsg').innerHTML = '<b>Please fix these errors and check again:</b><br>' + er.slice(0, 15).map(esc).join('<br>') + (er.length > 15 ? '<br>...and ' + (er.length - 15) + ' more' : ''); return; }
    pending = qs; $('qsave').disabled = false; msg($('qmsg'), 'File is correct. ' + qs.length + ' questions found. Press Save Questions to apply.', 'g');
  } catch (e) { msg($('qmsg'), 'Could not read the file: ' + e.message + '. Save it again as .xlsx or .csv using the template.', 'e'); }
}
async function saveQs() {
  if (!pending) return;
  try { const r = await api('/api/admin/questions', { course: $('qcourse').value, questions: pending }); msg($('qmsg'), 'Saved. ' + r.count + ' questions are now active for this course.', 'g'); pending = null; $('qsave').disabled = true; loadQs(); }
  catch (e) { msg($('qmsg'), e.message, 'e'); }
}

/* =============== SETTINGS =============== */
const THEMES = [['classic', 'Classic', 'linear-gradient(100deg,#1b1740,#4b2fd1 55%,#c2328a)'], ['minimal', 'Minimal', 'linear-gradient(#fff 55%,#111 55% 62%,#fafafa 62%)'], ['modern', 'Modern', 'linear-gradient(#0f172a 45%,#4f46e5 45% 55%,#f4f6fb 55%)'], ['premium', 'Premium', 'linear-gradient(#0f1b3d 45%,#c9a227 45% 52%,#faf8f3 52%)']];
const applyTheme = () => { if (window.setTheme) setTheme(SET.theme || 'classic', SET.center, 'Admin'); };
function viewSet() {
  const s = SET;
  $('pane').innerHTML = `
  <div class="box"><h3>Test Settings</h3>
   <div class="row2">
    <div><label class="lbl">Test duration (minutes)</label><input class="in" type="number" id="s_dur" min="1" max="300" value="${s.duration_min}"></div>
    <div><label class="lbl">End Paper unlocks after (minutes)</label><input class="in" type="number" id="s_unl" min="0" max="300" value="${s.unlock_min}"></div>
    <div><label class="lbl">Passing percentage</label><input class="in" type="number" id="s_pass" min="1" max="100" value="${s.pass_pct}"></div>
    <div><label class="lbl">Default entry window (minutes)</label><input class="in" type="number" id="s_ent" min="1" max="240" value="${s.entry_window_min}"></div>
    <div><label class="lbl">Auto-end test after N warnings (0 = only record)</label><input class="in" type="number" id="s_vio" min="0" max="50" value="${s.max_violations}"></div>
    <div><label class="lbl">Show result to student after test</label><select class="in" id="s_show"><option value="1" ${s.show_result ? 'selected' : ''}>Yes (score report)</option><option value="0" ${!s.show_result ? 'selected' : ''}>No (admin only)</option></select></div>
    <div><label class="lbl">Roll number prefix (optional, e.g. PSDC-)</label><input class="in" id="s_pre" maxlength="12" value="${esc(s.roll_prefix || '')}" placeholder="none"></div>
    <div><label class="lbl">Next roll number</label><input class="in" type="number" id="s_nr" min="1" max="99999999" value="${s.next_roll}"></div>
   </div>
   <label class="lbl">School / centre name (shown on the website, the browser tab title and all reports)</label><input class="in" id="s_center" value="${esc(s.center)}">
   <label class="lbl">Theme</label>
   <div class="thm" id="s_thm">${THEMES.map(([k, n, bg]) => `<label class="${(s.theme || 'classic') === k ? 'on' : ''}"><input type="radio" name="thm" value="${k}" ${(s.theme || 'classic') === k ? 'checked' : ''}><i style="background:${bg}"></i>${n}</label>`).join('')}</div>
   <p class="fine">Theme applies to the student website and this panel. Minimal, Modern and Premium are flat designs without animations. Time changes apply to students who start after you save. The next roll number only affects new students.</p>
   <div class="arow"><button class="btn" id="s_save">Save Settings</button></div><div id="s_msg" class="msg"></div>
  </div>
  <div class="box"><h3>Courses</h3>
   <p class="fine">Rename, hide or add courses. A course is shown to students only when it is not hidden <b>and</b> has questions (upload them in the Questions tab). A course that already has student records cannot be deleted, only hidden.</p>
   <div id="cbox"></div>
   <div class="arow"><button class="btn ghost" id="c_add">+ Add course</button><button class="btn" id="c_save">Save Courses</button></div><div id="c_msg" class="msg"></div>
  </div>
  <div class="box"><h3>Qualification Options</h3>
   <p class="fine">One option per line. Students pick one of these when they log in.</p>
   <textarea class="in" id="q_list" rows="7"></textarea>
   <div class="arow"><button class="btn" id="q_save">Save Qualifications</button></div><div id="qq_msg" class="msg"></div>
  </div>
  <div class="box"><h3>Change Admin Password</h3>
   <div class="row2"><div><label class="lbl">Current password</label><input class="in" type="password" id="p_cur"></div><div><label class="lbl">New password (min 8 characters)</label><input class="in" type="password" id="p_new"></div></div>
   <div class="arow"><button class="btn" id="p_save">Change Password</button></div><div id="p_msg" class="msg"></div>
  </div>`;
  $('s_thm').querySelectorAll('input').forEach(i => i.onchange = () => { $('s_thm').querySelectorAll('label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); if (window.setTheme) setTheme(i.value); });
  $('s_save').onclick = async () => {
    try {
      SET = await api('/api/admin/settings', { duration_min: $('s_dur').value, unlock_min: $('s_unl').value, pass_pct: $('s_pass').value, entry_window_min: $('s_ent').value, max_violations: $('s_vio').value, show_result: $('s_show').value === '1', center: $('s_center').value, roll_prefix: $('s_pre').value, next_roll: $('s_nr').value, theme: ($('s_thm').querySelector('input:checked') || {}).value });
      applyTheme(); viewSet(); $('s_msg').textContent = 'Settings saved.'; $('s_msg').className = 'msg g';
    } catch (e) { msg($('s_msg'), e.message, 'e'); }
  };
  const row = c => `<div class="crow" ${c.id ? `data-id="${c.id}"` : ''}><input class="in" maxlength="60" value="${esc(c.name || '')}" placeholder="Course name"><small>${c.id ? c.qn + ' questions' + (c.records ? ' \u00b7 ' + c.records + ' records' : '') : 'new'}</small><label style="margin:0;font-weight:500;white-space:nowrap"><input type="checkbox" ${c.hidden ? 'checked' : ''}> Hide</label><button class="btn ghost sm" data-del>Delete</button></div>`;
  const wire = () => $('cbox').querySelectorAll('[data-del]').forEach(b => b.onclick = () => b.closest('.crow').remove());
  api('/api/admin/courses').then(l => { $('cbox').innerHTML = l.map(row).join(''); wire(); });
  $('c_add').onclick = () => { $('cbox').insertAdjacentHTML('beforeend', row({})); wire(); $('cbox').lastElementChild.querySelector('input').focus(); };
  $('c_save').onclick = async () => {
    try {
      const list = [...$('cbox').children].map(r => ({ id: r.dataset.id, name: r.querySelector('input.in').value, hidden: r.querySelector('input[type=checkbox]').checked }));
      await api('/api/admin/courses', { list }); ME = await api('/api/admin/me');
      const l = await api('/api/admin/courses'); $('cbox').innerHTML = l.map(row).join(''); wire(); msg($('c_msg'), 'Courses saved. Upload questions for any new course in the Questions tab.', 'g');
    } catch (e) { msg($('c_msg'), e.message, 'e'); }
  };
  api('/api/admin/quals').then(l => $('q_list').value = l.join('\n'));
  $('q_save').onclick = async () => { try { const l = await api('/api/admin/quals', { list: $('q_list').value.split('\n') }); $('q_list').value = l.join('\n'); msg($('qq_msg'), 'Saved.', 'g'); } catch (e) { msg($('qq_msg'), e.message, 'e'); } };
  $('p_save').onclick = async () => {
    try { await api('/api/admin/password', { current: $('p_cur').value, next: $('p_new').value }); msg($('p_msg'), 'Password changed.', 'g'); $('p_cur').value = ''; $('p_new').value = ''; }
    catch (e) { msg($('p_msg'), e.message, 'e'); }
  };
}

/* =============== MASTER ADMIN (owner only) =============== */
async function viewMaster() {
  const st = await api('/api/admin/master/stats'), size = st.bytes > 1048576 ? (st.bytes / 1048576).toFixed(2) + ' MB' : (st.bytes / 1024).toFixed(1) + ' KB';
  $('pane').innerHTML = `
  <div class="box"><h3>Master Admin</h3><p class="fine">You are logged in as the owner. The school admin cannot see this tab or change anything here.</p>
   <div class="row2"><div class="stat"><b>${st.candidates}</b><span>Student records</span></div><div class="stat"><b>${st.archive}</b><span>Archived retakes</span></div><div class="stat"><b>${size}</b><span>Approx. data size</span></div></div></div>
  <div class="box"><h3>Site Status</h3>
   <div class="row2"><div><label class="lbl">Status</label><select class="in" id="m_act"><option value="1" ${st.site.active ? 'selected' : ''}>Active</option><option value="0" ${!st.site.active ? 'selected' : ''}>Suspended (students and school admin are blocked)</option></select></div>
   <div><label class="lbl">Message shown when suspended</label><input class="in" id="m_msg" maxlength="200" value="${esc(st.site.message || '')}" placeholder="e.g. Service paused. Contact the owner."></div></div>
   <div class="arow"><button class="btn" id="m_site">Save Status</button></div><div id="m_smsg" class="msg"></div></div>
  <div class="box"><h3>School Admin Password</h3><p class="fine">Reset the school admin's password without knowing the old one.</p>
   <div class="row2"><div><label class="lbl">New password (min 8 characters)</label><input class="in" type="password" id="m_pw"></div></div>
   <div class="arow"><button class="btn" id="m_pwb">Reset Admin Password</button></div><div id="m_pmsg" class="msg"></div></div>
  <div class="box"><h3>Delete Old Data</h3><p class="fine">Frees space and keeps the system light. This cannot be undone, so download the CSV/Excel from the Results tab first. Questions, settings and courses are never deleted.</p>
   <div class="scroll"><table class="dt"><tr><th>Test date</th><th>Students</th><th></th></tr>${st.dates.map(d => `<tr><td>${esc(d.date)}</td><td>${d.n}</td><td><button class="btn ghost sm" data-day="${d.date}">Delete this date</button></td></tr>`).join('') || '<tr><td colspan="3">No data stored.</td></tr>'}</table></div>
   <div class="arow" style="align-items:end"><div><label class="lbl">Delete everything before</label><input class="in" type="date" id="m_before"></div><button class="btn red" id="m_bb">Delete older data</button><button class="btn red" id="m_all">Delete ALL data</button></div><div id="m_dmsg" class="msg"></div></div>`;
  const wipe = async (body, what) => {
    const t = prompt('This cannot be undone.\n' + what + '\n\nType DELETE to confirm:'); if (t !== 'DELETE') return;
    try { const r = await api('/api/admin/master/delete', { ...body, confirm: 'DELETE' }); await viewMaster(); msg($('m_dmsg'), 'Deleted ' + r.deleted + ' student record(s).', 'g'); } catch (e) { msg($('m_dmsg'), e.message, 'e'); }
  };
  $('m_site').onclick = async () => { try { await api('/api/admin/master/site', { active: $('m_act').value === '1', message: $('m_msg').value }); msg($('m_smsg'), 'Saved.', 'g'); } catch (e) { msg($('m_smsg'), e.message, 'e'); } };
  $('m_pwb').onclick = async () => { try { await api('/api/admin/master/admin-password', { next: $('m_pw').value }); $('m_pw').value = ''; msg($('m_pmsg'), 'Admin password reset. The school admin was logged out.', 'g'); } catch (e) { msg($('m_pmsg'), e.message, 'e'); } };
  $('pane').querySelectorAll('[data-day]').forEach(b => b.onclick = () => wipe({ mode: 'date', date: b.dataset.day }, 'All students of ' + b.dataset.day + ' will be deleted.'));
  $('m_bb').onclick = () => { const d = $('m_before').value; if (!d) return alert('Choose a date first.'); wipe({ mode: 'before', date: d }, 'All students tested before ' + d + ' will be deleted.'); };
  $('m_all').onclick = () => wipe({ mode: 'all' }, 'ALL student results will be deleted.');
}

init();
})();
