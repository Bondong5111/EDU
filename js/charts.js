'use strict';
/* =========================================================
 * 차트 (의존성 없는 SVG)
 * ========================================================= */
const ico = (name) => `<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const md = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

// 카드 안의 작은 추세선
function spark(vals, { w = 120, h = 36, color = 'var(--primary)' } = {}) {
  const pts = vals.map((v, i) => [i, v]).filter((p) => p[1] != null);
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="2" x2="${w - 2}" y1="${h - 4}" y2="${h - 4}" stroke="var(--line)" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/></svg>`;
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  const x = (i) => 3 + (i * (w - 6)) / Math.max(1, vals.length - 1);
  const y = (v) => (hi === lo ? h / 2 : 4 + (h - 8) * (1 - (v - lo) / (hi - lo)));
  const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="${line}L${x(last[0]).toFixed(1)} ${h}L${x(pts[0][0]).toFixed(1)} ${h}Z" fill="${color}" opacity=".1"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3" fill="${color}"/></svg>`;
}

// 달성 링
function ring(pct, label, text, color = 'var(--primary)') {
  const r = 24, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="ring" title="${esc(label)} ${esc(text)}"><svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
    <circle cx="30" cy="30" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="6"/>
    <circle class="ring-arc" cx="30" cy="30" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${((c * p) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 30 30)"/>
    <text x="30" y="34" text-anchor="middle">${esc(text)}</text></svg><span>${esc(label)}</span></div>`;
}

// 기간 추세 (점을 누르면 그날로 이동)
function lineChart(el, pts, { min, max, color = 'var(--primary)', fmt = (v) => String(v), empty = '아직 기록이 없어요' } = {}) {
  const vals = pts.filter((p) => p.v != null);
  if (!vals.length) { el.innerHTML = `<div class="empty-state">${esc(empty)}</div>`; return; }
  const W = Math.max(280, el.clientWidth || 600), H = 230, L = 44, R = 14, T = 14, B = 28;
  let lo = min ?? Math.min(...vals.map((p) => p.v)), hi = max ?? Math.max(...vals.map((p) => p.v));
  if (min == null && max == null) { const padv = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1; lo -= padv; hi += padv; }
  if (hi === lo) hi = lo + 1;
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  const ticks = Math.min(pts.length, W < 480 ? 4 : 7);
  for (let t = 0; t < ticks; t++) {
    const i = ticks === 1 ? 0 : Math.round((t * (pts.length - 1)) / (ticks - 1));
    svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${md(pts[i].date)}</text>`;
  }
  const idx = pts.map((p, i) => [i, p.v]).filter((p) => p[1] != null);
  const line = idx.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
  const avg = mean(vals.map((p) => p.v));
  svg += `<path d="${line}L${x(idx[idx.length - 1][0]).toFixed(1)} ${H - B}L${x(idx[0][0]).toFixed(1)} ${H - B}Z" fill="${color}" opacity=".08"/>
    <line class="avg" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (idx.length <= 100) {
    for (const [i, v] of idx) svg += `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${color}" data-day="${pts[i].date}"><title>${md(pts[i].date)} · ${esc(fmt(v))}</title></circle>`;
  }
  el.innerHTML = svg + '</svg>';
}

// 요일별 막대
function barChart(el, items, { fmt = (v) => String(v), lo = 0, hi } = {}) {
  const vals = items.filter((i) => i.v != null);
  if (!vals.length) { el.innerHTML = '<div class="empty-state">아직 기록이 없어요</div>'; return; }
  const top = hi ?? Math.max(...vals.map((i) => i.v));
  const best = Math.max(...vals.map((i) => i.v));
  el.innerHTML = `<div class="bars">${items.map((i) => {
    const pct = i.v == null ? 0 : Math.max(4, ((i.v - lo) / (top - lo || 1)) * 100);
    return `<div class="bar-col"><span class="bar-val">${i.v == null ? '' : esc(fmt(i.v))}</span>
      <div class="bar-track"><div class="bar-fill ${i.v === best ? 'best' : ''}" style="height:${pct}%"></div></div><span class="bar-label">${esc(i.label)}</span></div>`;
  }).join('')}</div>`;
}

// 최근 1년 히트맵 (칸을 누르면 그날로 이동)
function heatmap(mode) {
  const today = parseYmd(todayStr()), todayS = todayStr();
  const start = new Date(today); start.setDate(start.getDate() - (52 * 7 + today.getDay()));
  const cell = 12, gap = 3, left = 20, top = 18, step = cell + gap, cols = 53;
  let svg = `<svg class="heat" width="${left + cols * step}" height="${top + 7 * step}" role="img" aria-label="최근 1년 기록">`;
  [1, 3, 5].forEach((r) => { svg += `<text x="0" y="${top + r * step + 10}">${WEEK[r]}</text>`; });
  let lastMonth = -1;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start); d.setDate(start.getDate() + c * 7 + r);
      const ds = ymd(d);
      if (ds > todayS) continue;
      if (r === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) { lastMonth = d.getMonth(); svg += `<text x="${left + c * step}" y="11">${d.getMonth() + 1}월</text>`; }
      let klass = '', tip = '기록 없음';
      if (mode === 'habit') {
        const rate = habitRate(ds);
        if (rate != null) { klass = 'h' + (rate === 0 ? 1 : 1 + Math.ceil(rate / 25)); tip = `습관 ${Math.round(rate)}%`; }
      } else {
        const m = state.logs[ds]?.mood;
        if (m != null) { klass = 'm' + m; tip = `기분 ${MOOD_LABEL[m]}`; } else if (state.logs[ds] || state.habitChecks[ds]) { klass = 'has'; tip = '기록 있음'; }
      }
      svg += `<rect class="hc ${klass}${ds === todayS ? ' now' : ''}" x="${left + c * step}" y="${top + r * step}" width="${cell}" height="${cell}" rx="3.5" data-day="${ds}"><title>${fmtDate(ds)} · ${tip}</title></rect>`;
    }
  }
  return svg + '</svg>';
}
