(function () {
'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0'), pad2 = pad;
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const D = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const T = d => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const BASE = (window.API_BASE || '').replace(/\/+$/, '');
const tok = () => { try { return sessionStorage.getItem('ssid') || ''; } catch (e) { return ''; } };
async function api(path, body) {
  const parts = path.split('?'), q = {};
  if (parts[1]) new URLSearchParams(parts[1]).forEach((v, k) => { q[k] = v; });
  let j;
  try {
    // plain-text POST: works from GitHub Pages without any CORS set-up
    const r = await fetch(BASE, { method: 'POST', redirect: 'follow', body: JSON.stringify({ path: parts[0], q, token: tok(), body: body === undefined ? {} : body }) });
    j = await r.json();
  } catch (e) { throw new Error('Cannot reach the server. Check your internet connection.'); }
  if (j.status !== 200) { const e = new Error(j.error || 'Request failed'); e.status = j.status; throw e; }
  return j.data;
}
const DK = (() => { try { let d = localStorage.getItem('dk'); if (!d) { d = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('dk', d); } return d; } catch (e) { return 'x' + Math.random().toString(36).slice(2); } })();
function show(id) { ['login', 'reg', 'test'].forEach(x => $(x).classList.toggle('hidden', x !== id)); if (id === 'test') $('test').style.display = 'flex'; }

const S = { st: null, cur: 0, ans: [], off: 0, deadline: 0, unlock: 0, total: 0, iv: null, over: false, pending: {} };

/* ---------- login ---------- */
async function pubStatus() {
  try {
    const p = await api('/api/public');
    $('center').textContent = p.center; if (window.setTheme) setTheme(p.theme || 'classic', p.center, 'Online Entry Test');
    if (p.quals && !$('lqual').options.length) { $('lqual').add(new Option('Select your qualification', '')); p.quals.forEach(q => $('lqual').add(new Option(q, q))); }
    if (p.courses && !$('lcourse').options.length) { const ph = new Option('Select your course', ''); $('lcourse').add(ph); p.courses.forEach(c => $('lcourse').add(new Option(c.name, c.id))); }
    const on = p.entryOpen; const el = $('entryst');
    el.className = 'status ' + (on ? 'on' : 'off');
    el.textContent = p.suspended ? (p.message || 'Temporarily unavailable') : on ? 'Entry is OPEN' : 'Entry is CLOSED';
  } catch (e) {}
}
pubStatus(); setInterval(() => { if (!$('login').classList.contains('hidden')) pubStatus(); }, 15000);

['sn', 'fn', 'code'].forEach((id, i, arr) => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') (arr[i + 1] ? $(arr[i + 1]).focus() : $('lgo').click()); }));
$('lgo').onclick = async () => {
  $('lerr').textContent = '';
  const name = $('sn').value.trim(), father = $('fn').value.trim(), course = $('lcourse').value, qual = $('lqual').value, code = $('code').value.trim();
  if (!name || !father || !course || !qual || !code) { $('lerr').textContent = 'Please fill in all the fields.'; return; }
  $('lgo').disabled = true;
  try { const st = await api('/api/login', { name, father, course, qual, code, dk: DK }); try { sessionStorage.setItem('ssid', st.token); } catch (e) {} $('code').value = ''; route(st); }
  catch (e) { $('lerr').textContent = e.message; }
  $('lgo').disabled = false;
};

/* resume after refresh */
(async () => { if (!tok()) return; try { route(await api('/api/me')); } catch (e) { try { sessionStorage.removeItem('ssid'); } catch (x) {} } })();

function route(st) {
  S.st = st; S.off = st.now - Date.now();
  $('center').textContent = st.center || $('center').textContent;
  if (st.stage === 'ready') {
    $('rcourse').textContent = st.course;
    $('iname').textContent = st.name; $('ifather').textContent = st.father; $('iroll').textContent = st.roll; $('iqual').textContent = st.qual || '';
    $('rules').innerHTML = '';
    [
      'Total time is ' + st.duration_min + ' minutes for the whole paper, not per question.',
      'Each question carries 1 mark. There is no negative marking.',
      'You can move to any question using Next, Previous or the question numbers.',
      'The End Paper button becomes active when all questions are answered, or after ' + st.unlock_min + ' minutes.',
      'The test ends automatically when the time is over. The timer cannot be paused or restarted.',
      'Do not switch tabs, leave the page, or open other windows. Every such action is recorded and shown to the administrator.',
      'You have only one attempt. Once you press Start Test, you cannot take this test again.'
    ].forEach(t => { const li = document.createElement('li'); li.textContent = t; $('rules').appendChild(li); });
    $('serr').textContent = ''; show('reg');
  } else if (st.stage === 'running') beginTest(st);
  else finishedUI(st);
}
$('regBack').onclick = () => leave();
$('go').onclick = async () => {
  $('serr').textContent = ''; $('go').disabled = true;
  try { const st = await api('/api/start', {}); route(st); try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch (e) {} }
  catch (e) { $('serr').textContent = e.message; }
  $('go').disabled = false;
};

/* ---------- test ---------- */
function beginTest(st) {
  S.cur = 0; S.over = false; S.ans = st.answers.slice(); S.total = st.questions.length; S.Q = st.questions;
  S.deadline = st.deadline; S.unlock = st.unlockSec; S.startedAt = st.startedAt; S.dur = st.durationSec;
  $('wn').textContent = st.name; $('wf').textContent = 'S/O ' + st.father; $('wc').textContent = 'Course: ' + st.course + '  |  Roll No: ' + st.roll;
  $('pal').innerHTML = '';
  S.Q.forEach((_, i) => { const b = document.createElement('button'); b.textContent = i + 1; b.onclick = () => { S.cur = i; render(); }; $('pal').appendChild(b); });
  show('test'); render(); armGuards();
  clearInterval(S.iv); S.iv = setInterval(tick, 250); tick();
  window.onbeforeunload = e => { if (!S.over) { e.preventDefault(); e.returnValue = ''; } };
}
const nowS = () => Date.now() + S.off;
function tick() {
  if (S.over) return;
  const left = Math.max(0, Math.ceil((S.deadline - nowS()) / 1000));
  $('tm').textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
  $('tm').classList.toggle('low', left <= 300);
  $('pg').style.width = Math.min(100, (S.dur - left) / S.dur * 100) + '%';
  const all = S.ans.every(a => a >= 0), unlocked = (nowS() - S.startedAt) / 1000 >= S.unlock;
  $('end').disabled = !(all || unlocked);
  $('endhint').textContent = (all || unlocked) ? 'You can end the paper now.' : 'End Paper activates when all questions are answered, or after ' + Math.round(S.unlock / 60) + ' minutes.';
  if (left <= 0) submit();
}
function render() {
  const q = S.Q[S.cur], N = S.total;
  $('qn').textContent = 'Question ' + (S.cur + 1) + ' of ' + N; $('qt').textContent = q.q; $('opts').innerHTML = '';
  q.o.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'opt' + (S.ans[S.cur] === i ? ' sel' : '');
    const em = document.createElement('em'); em.textContent = 'ABCD'[i]; const sp = document.createElement('span'); sp.textContent = t; d.append(em, sp);
    d.onclick = () => { S.ans[S.cur] = i; saveAns(S.cur, i); render(); };
    $('opts').appendChild(d);
  });
  $('prev').disabled = S.cur === 0; $('next').disabled = S.cur === N - 1;
  [...$('pal').children].forEach((b, i) => b.className = (S.ans[i] >= 0 ? 'ans ' : '') + (i === S.cur ? 'cur' : ''));
  $('cnt').textContent = 'Answered: ' + S.ans.filter(a => a >= 0).length + ' / ' + N; tick();
}
$('prev').onclick = () => { if (S.cur > 0) { S.cur--; render(); } };
$('next').onclick = () => { if (S.cur < S.total - 1) { S.cur++; render(); } };

/* answers are saved on the server immediately; failed saves are retried */
async function saveAns(i, opt) {
  S.pending[i] = opt;
  try { const r = await api('/api/answer', { i, opt }); if (S.pending[i] === opt) delete S.pending[i]; if (r.finished) submit(); } catch (e) { if (e.status === 401) { try { sessionStorage.removeItem('ssid'); } catch (x) {} location.reload(); } }
}
setInterval(() => { Object.keys(S.pending).forEach(i => saveAns(+i, S.pending[i])); }, 3000);

$('end').onclick = () => { const u = S.ans.filter(a => a < 0).length; $('cmsg').textContent = u ? u + ' question(s) are still unanswered. Do you want to end the paper?' : 'All questions are answered. Do you want to end the paper?'; $('confirm').classList.remove('hidden'); };
$('cno').onclick = () => $('confirm').classList.add('hidden');
$('cyes').onclick = () => { $('confirm').classList.add('hidden'); submit(); };

let submitting = false;
async function submit() {
  if (submitting || S.over) return; submitting = true;
  try {
    for (const i of Object.keys(S.pending)) { try { await api('/api/answer', { i: +i, opt: S.pending[i] }); } catch (e) {} }
    const st = await api('/api/finish', {});
    S.over = true; clearInterval(S.iv); window.onbeforeunload = null; $('confirm').classList.add('hidden'); finishedUI(st);
  } catch (e) { /* network problem or not yet allowed: tick() will retry when time is over */ }
  submitting = false;
}
function finishedUI(st) {
  S.over = true; S.st = st; window.onbeforeunload = null; clearInterval(S.iv);
  try { document.fullscreenElement && document.exitFullscreen(); } catch (e) {}
  ['login', 'reg', 'test'].forEach(x => $(x).classList.add('hidden'));
  $('done').classList.remove('hidden');
  if (st.result) { $('dmsg').textContent = 'Your test is complete. Press the button below to see your result.'; $('vr').classList.remove('hidden'); $('dout').classList.add('hidden'); }
  else { $('dmsg').textContent = 'Your test is complete and your answers are submitted. Your result will be announced by the centre.'; $('vr').classList.add('hidden'); $('dout').classList.remove('hidden'); }
}
async function leave() { try { await api('/api/logout', {}); } catch (e) {} try { sessionStorage.removeItem('ssid'); } catch (e) {} location.reload(); }
$('dout').onclick = leave; $('dout2').onclick = leave; $('prt').onclick = () => window.print();

/* ---------- result report (score only, no question review) ---------- */
$('vr').onclick = () => {
  const r = S.st && S.st.result; if (!r) return;
  const N = r.total, c = r.correct, w = r.wrong, u = r.unanswered, pct = r.pct;
  const segs = [[c, '#0b9f6e'], [w, '#e0445a'], [u, '#9aa5b8']], R = 54, C = 2 * Math.PI * R; let off = 0;
  const arcs = segs.map(([v, col]) => { const l = v / N * C, s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += l; return s; }).join('');
  const bars = [['Correct', c, '#0b9f6e'], ['Wrong', w, '#e0445a'], ['Not attempted', u, '#9aa5b8']].map(([l, v, col], i) => `<text x="0" y="${24 + i * 38}" font-size="13" fill="#333">${l}</text><rect x="110" y="${9 + i * 38}" width="${Math.max(2, v / N * 330)}" height="22" rx="4" fill="${col}"/><text x="${118 + v / N * 330}" y="${26 + i * 38}" font-size="13" font-weight="700" fill="#111">${v}</text>`).join('');
  const used = r.used, st = r.startedAt, en = r.finishedAt;
  $('sheet').innerHTML = `
  <div class="rh"><h1>${esc(S.st.center || '')}</h1><p>Entry Test Result Report &mdash; ${esc(r.course)}</p></div>
  <table class="info">
   <tr><td>Student Name</td><td>${esc(r.name)}</td><td>Father Name</td><td>${esc(r.father)}</td></tr>
   <tr><td>Course</td><td>${esc(r.course)}</td><td>Roll No.</td><td>${esc(r.roll)}</td></tr>
   <tr><td>Qualification</td><td colspan="3">${esc(r.qual || '-')}</td></tr>
   <tr><td>Test Date</td><td>${D(st)}</td><td>Day</td><td>${new Date(st).toLocaleDateString('en-US', { weekday: 'long' })}</td></tr>
   <tr><td>Start Time</td><td>${T(st)}</td><td>End Time</td><td>${T(en)}</td></tr>
   <tr><td>Time Allowed</td><td>${S.st.duration_min} minutes</td><td>Time Used</td><td>${pad(Math.floor(used / 60))}:${pad(used % 60)} (mm:ss)</td></tr>
  </table>
  <div class="score"><div><b>${N}</b><span>Total Marks</span></div><div><b>${c}</b><span>Obtained Marks</span></div><div><b>${pct}%</b><span>Percentage</span></div><div><b>${r.grade}</b><span>Grade</span></div></div>
  <div class="score"><div><b>${r.attempted}</b><span>Attempted</span></div><div><b>${c}</b><span>Correct</span></div><div><b>${w}</b><span>Wrong</span></div><div><b>${u}</b><span>Not Attempted</span></div></div>
  <div class="res ${r.pass ? 'p' : 'f'}">Result: ${r.pass ? 'PASS' : 'FAIL'} &nbsp;(Obtained ${c} out of ${N} marks &bull; Passing percentage ${r.passPct}%)</div>
  <div class="charts"><svg viewBox="0 0 140 140" width="180" height="180">${arcs}<text x="70" y="68" text-anchor="middle" font-size="22" font-weight="700" fill="#111">${pct}%</text><text x="70" y="86" text-anchor="middle" font-size="11" fill="#555">Score</text></svg>
   <svg viewBox="0 0 480 120" width="100%">${bars}</svg></div>
  <div class="rf">Report generated on ${D(Date.now())} at ${T(Date.now())} &bull; Computer generated report</div>`;
  $('done').classList.add('hidden'); $('report').classList.remove('hidden');
};


/* ---------- result as JPG (drawn directly on a canvas, no libraries) ---------- */
function downloadJpg() {
  const r = S.st && S.st.result; if (!r) return;
  const W = 1240, H = 1130, pad = 70, IW = W - pad * 2, SERIF = 'Georgia,"Times New Roman",serif', SANS = '"Segoe UI",Roboto,Arial,sans-serif';
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.textBaseline = 'middle';
  const fit = (t, font, size, maxW, bold) => { t = String(t == null ? '' : t); do { g.font = (bold ? 'bold ' : '') + size + 'px ' + font; size -= 1; } while (g.measureText(t).width > maxW && size > 9); return t; };
  const txt = (t, x, y, font, size, color, align, bold, maxW) => { t = fit(t, font, size, maxW || 99999, bold); g.fillStyle = color || '#111'; g.textAlign = align || 'left'; g.fillText(t, x, y); };
  const N = r.total, c0 = r.correct, w = r.wrong, u = r.unanswered, pct = r.pct;
  txt(S.st.center || '', W / 2, 78, SERIF, 40, '#111', 'center', true, IW);
  txt('Entry Test Result Report \u2014 ' + r.course, W / 2, 124, SANS, 22, '#444', 'center', false, IW);
  g.fillStyle = '#1b1740'; g.fillRect(pad, 152, IW, 2); g.fillRect(pad, 158, IW, 2);
  const st = r.startedAt, en = r.finishedAt, used = r.used;
  const rows = [
    [['Student Name', r.name], ['Father Name', r.father]],
    [['Course', r.course], ['Roll No.', r.roll]],
    [['Qualification', r.qual || '-']],
    [['Test Date', D(st)], ['Day', new Date(st).toLocaleDateString('en-US', { weekday: 'long' })]],
    [['Start Time', T(st)], ['End Time', T(en)]],
    [['Time Allowed', S.st.duration_min + ' minutes'], ['Time Used', pad2(Math.floor(used / 60)) + ':' + pad2(used % 60) + ' (mm:ss)']]
  ];
  const LW = 210, RH = 46; let y = 190;
  rows.forEach(row => {
    let x = pad; const vw = row.length === 1 ? IW - LW : (IW - LW * 2) / 2;
    row.forEach(([l, v]) => {
      g.fillStyle = '#f1f0fb'; g.fillRect(x, y, LW, RH); g.strokeStyle = '#bbb'; g.lineWidth = 1.5; g.strokeRect(x, y, LW, RH); g.strokeRect(x + LW, y, vw, RH);
      txt(l, x + 14, y + RH / 2, SANS, 20, '#111', 'left', true, LW - 20); txt(v, x + LW + 14, y + RH / 2, SANS, 20, '#111', 'left', false, vw - 28); x += LW + vw;
    }); y += RH;
  });
  y += 24;
  const boxes = (arr) => { const bw = (IW - 42) / 4; arr.forEach(([v, l], i) => { const x = pad + i * (bw + 14); g.strokeStyle = '#bbb'; g.lineWidth = 1.5; g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, 92, 10) : g.rect(x, y, bw, 92); g.stroke(); txt(v, x + bw / 2, y + 36, SERIF, 38, '#111', 'center', true, bw - 16); txt(l, x + bw / 2, y + 72, SANS, 16, '#555', 'center', false, bw - 16); }); y += 106; };
  boxes([[N, 'Total Marks'], [c0, 'Obtained Marks'], [pct + '%', 'Percentage'], [r.grade, 'Grade']]);
  boxes([[r.attempted, 'Attempted'], [c0, 'Correct'], [w, 'Wrong'], [u, 'Not Attempted']]);
  y += 4; g.fillStyle = r.pass ? '#e3f6ee' : '#fde8eb'; g.fillRect(pad, y, IW, 58);
  txt('Result: ' + (r.pass ? 'PASS' : 'FAIL') + '   (Obtained ' + c0 + ' out of ' + N + ' marks \u2022 Passing percentage ' + r.passPct + '%)', W / 2, y + 29, SANS, 24, r.pass ? '#0b9f6e' : '#e0445a', 'center', true, IW - 20);
  y += 58 + 28;
  const cx = pad + 140, cy = y + 120, R = 84; let a0 = -Math.PI / 2; g.lineWidth = 36;
  [[c0, '#0b9f6e'], [w, '#e0445a'], [u, '#9aa5b8']].forEach(([v, col]) => { if (!v) return; const a1 = a0 + v / N * Math.PI * 2; g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke(); a0 = a1; });
  txt(pct + '%', cx, cy - 8, SERIF, 34, '#111', 'center', true, 110); txt('Score', cx, cy + 22, SANS, 16, '#555', 'center');
  [['Correct', c0, '#0b9f6e'], ['Wrong', w, '#e0445a'], ['Not attempted', u, '#9aa5b8']].forEach(([l, v, col], i) => {
    const by = y + 40 + i * 70, bx = pad + 330, maxW = IW - 330 - 80;
    txt(l, bx, by + 14, SANS, 20, '#333'); g.fillStyle = col; g.fillRect(bx + 160, by, Math.max(4, v / N * (maxW - 160)), 28); txt(v, bx + 160 + Math.max(4, v / N * (maxW - 160)) + 12, by + 14, SANS, 20, '#111', 'left', true);
  });
  txt('Report generated on ' + D(Date.now()) + ' at ' + T(Date.now()) + ' \u2022 Computer generated report', W / 2, H - 34, SANS, 16, '#666', 'center', false, IW);
  const a = document.createElement('a'); a.href = c.toDataURL('image/jpeg', 0.93);
  a.download = 'Result_' + r.roll + '_' + String(r.name).replace(/[^a-z0-9]+/gi, '_') + '.jpg'; document.body.appendChild(a); a.click(); a.remove();
}
$('jpg').onclick = downloadJpg;

/* ---------- anti-cheating guards (deterrent + logging; real security is on the server) ---------- */
let guardsOn = false, lastV = 0;
function violation(type) {
  if (S.over || Date.now() - lastV < 1500) return; lastV = Date.now();
  api('/api/violation', { type }).then(r => { if (r.finished) submit(); }).catch(() => {});
  $('wmsg').textContent = 'Leaving the test page was detected and recorded. The administrator will see this in your result.'; $('warn').classList.remove('hidden');
}
$('wok').onclick = () => { $('warn').classList.add('hidden'); try { document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen(); } catch (e) {} };
function armGuards() {
  if (guardsOn) return; guardsOn = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) violation('tab-hidden'); });
  window.addEventListener('blur', () => violation('window-blur'));
  const block = e => { if (!$('test').classList.contains('hidden')) e.preventDefault(); };
  ['contextmenu', 'copy', 'cut', 'paste', 'dragstart', 'selectstart'].forEach(ev => document.addEventListener(ev, block));
  document.addEventListener('keydown', e => {
    if ($('test').classList.contains('hidden')) return;
    const k = e.key.toLowerCase();
    if (k === 'f12' || (e.ctrlKey && ['u', 's', 'p', 'c', 'a'].includes(k)) || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k))) e.preventDefault();
  });
}
})();
