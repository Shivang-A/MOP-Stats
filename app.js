/* ============================================================
   Montreal Protocol Dashboard — app.js  (v9)
   Loads MP-treaty-status-MASTER.xlsx (via datalayer.js), builds figures,
   runs scroll animations + PNG export.

   v9 changes (all tunable via the CONFIG block below):
   - Two-tier fonts: bigger on screen, bigger still on export.
   - Figure 1: custom HTML legend (taller/longer bars, Kigali stays dashed),
     HTML tooltip that is always in front, stronger era shading.
   - Figure 1: dedicated LANDSCAPE print export, rendered natively at high DPI
     (monitor-independent, no upscaling) straight to a PNG blob.
   - Per-instrument PNG buttons on Fig 2 (ratifications) and Fig 5 (first 10),
     alongside the existing whole-card buttons.
   - All downloads use Blob URLs (safe for very large / high-DPI files).
   ============================================================ */

/* ============================================================
   CONFIG — tune everything here, then reload.
   ============================================================ */
const CONFIG = {
  // Native-render resolution for the print-grade figures (Fig 1 landscape,
  // Fig 2 per-instrument). 300 = standard print, 600 = luxurious, 800 = max.
  // 800 DPI keeps the flagship figure at 7200x4800 px, which is within
  // Chrome's canvas limits. Use Chrome for the 800 DPI exports; Safari caps
  // canvas area lower and may fail at 800.
  PRINT_DPI: 800,

  // Physical size (inches, w x h) of the native-rendered print figures.
  LANDSCAPE_IN: [9, 6],     // Fig 1, book turned sideways (6x9 paperback)
  PANEL_IN:     [6.4, 4.4], // Fig 2 per-instrument small multiple

  // html2canvas scale for the HTML-based exports (these can't be rendered
  // natively by a chart engine, so they are captured from the DOM).
  LIST_SCALE: 5,   // Fig 5 per-instrument lists (small cards -> safe at 5x)
  CARD_SCALE: 3,   // whole-card convenience exports

  // Font multipliers, relative to the original sizes.
  FS_SCREEN:   1.28,  // on-screen dashboard (tier 1)
  FS_CARD_EXP: 1.55,  // whole-card raster exports (tier 2)
};

/* Original Figure-1 base font sizes (px). Everything scales off these. */
const CUM_BASE = {
  tick: 14, axisTitle: 15, era: 11.8, eraShort: 11.8,
  star: 11.3, starGlyph: 24, blueBar: 12.8, marker: 11.6, mlf: 11,
};

/* Explicit Figure-1 LANDSCAPE export config (drawn on an 864x576 logical
   canvas -> scaled up to PRINT_DPI). Sizes are in logical px; on a 9-inch
   wide canvas, 1 logical px ~= 0.75pt, so 15px ~= 11pt in the book. */
const CUM_EXPORT = {
  fs: 1.30,          // annotation scale (era labels, star, markers)
  // Sized for the book: on the 864px-wide logical canvas 1px ~= 0.75pt at 9in
  // wide, so tick 19 ~= 14pt at 9in and still ~9.5pt if placed at 6in wide.
  tick: 19, axisTitle: 23,
  title: 25, titleMin: 17, subtitle: 13, subtitleMin: 10, source: 12,
  rot: 11, rotBlue: 11, mlf: 10.5,   // smaller rotated vertical-line labels for print
  legendFont: 15, legendBarW: 46, legendBarH: 15,
  padTop: 162, padBottom: 128, padLeft: 12, padRight: 26,
};

const INST_COLORS = {
  "Vienna (1985)":"#0B3954","MP (1987)":"#1D5F78","London (1990)":"#2D7C89",
  "Copenhagen (1992)":"#4F9D5D","Montreal (1997)":"#9B5089","Beijing (1999)":"#C57B3C",
  "Kigali (2016)":"#B0392B"
};
const PAIRS = {
  "Vienna (1985)":["#1F3A93","#8C9BD8"],"MP (1987)":["#1E88A8","#8FD0E0"],
  "London (1990)":["#2E8B57","#90CFA8"],"Copenhagen (1992)":["#C9A227","#E8D58A"],
  "Montreal (1997)":["#7A3E9D","#BFA0DA"],"Beijing (1999)":["#B5651D","#E0A971"],
  "Kigali (2016)":["#B0392B","#E29084"]
};
const ORDER = ["Vienna (1985)","MP (1987)","London (1990)","Copenhagen (1992)",
               "Montreal (1997)","Beijing (1999)","Kigali (2016)"];

/* Flags are bundled PNGs in ./flags/<iso2>.png (rasterised from the MIT-licensed
   flag-icons set at 160x120, which survives html2canvas export unlike raw SVG), so they render identically on
   Windows/Edge (which has no flag glyphs in Segoe UI Emoji), macOS and mobile.
   ISO2 comes from the master spreadsheet. */
function flagFor(r){
  const code = (r && r.iso2 ? r.iso2 : '').trim().toLowerCase();
  if(!code) return '';
  const alt = (r && r.country ? r.country : code).replace(/"/g,'&quot;');
  return `<img class="flagimg" src="flags/${code}.png" alt="${alt}" loading="eager">`;
}

let D = null;
let cumChart = null, cumBuilt = false, ratifBuilt = false, mapBuilt = false;
let ratifCharts = [];          // {name, chart}
let scrollTicking = false;

/* ---------- helper utilities ---------- */
const wait = (ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const nextFrame = ()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
async function settlePaint(frames=2){
  if(document.fonts && document.fonts.ready) await document.fonts.ready.catch(()=>{});
  for(let i=0;i<frames;i++) await nextFrame();
}
function fmt(v){ return (typeof v === 'number') ? v.toLocaleString() : v; }
function slug(s){
  return String(s).toLowerCase().replace(/[()]/g,'').replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'');
}
/* Download any canvas as a PNG using a Blob URL (safe for large files). */
function canvasToDownload(canvas, fname){
  return new Promise(resolve=>{
    const finish = (url, revoke)=>{
      const a=document.createElement('a');
      a.href=url; a.download=fname+'.png';
      document.body.appendChild(a); a.click(); a.remove();
      if(revoke) setTimeout(()=>URL.revokeObjectURL(url), 4000);
      resolve();
    };
    try{
      canvas.toBlob(b=>{
        if(b) finish(URL.createObjectURL(b), true);
        else  finish(canvas.toDataURL('image/png'), false);
      }, 'image/png');
    }catch(e){ finish(canvas.toDataURL('image/png'), false); }
  });
}

/* ---------- stat + analysis cards ---------- */
function hydrateNumbers(){
  if(!D.summary) return;
  document.querySelectorAll('[data-kpi]').forEach(el=>{
    const key = el.getAttribute('data-kpi');
    if(D.summary[key] !== undefined) el.textContent = fmt(D.summary[key]);
  });
}
function cardHTML(c){
  return `<article class="insight-card">
    <div class="value">${c.value}</div>
    <div class="label">${c.label}</div>
    <p>${c.text}</p>
  </article>`;
}
function buildInsightCards(){
  const intro = document.getElementById('introInsights');
  const closing = document.getElementById('closingInsights');
  if(intro && D.analysisCards) intro.innerHTML = D.analysisCards.map(cardHTML).join('');
  if(closing && D.closingCards) closing.innerHTML = D.closingCards.map(cardHTML).join('');
}

/* ============================================================
   FIGURE 1 — era + milestone annotation plugin.
   Reads config from options.plugins.vlines:
     events      : milestone rows
     fs          : font/geometry scale (screen tier vs export tier)
     bandAlpha   : {blue, green} era-shading opacity
     exportMode  : when true, also draws the on-canvas title/legend/source
                   (used only by the landscape print export)
     title/subtitle/source : export chrome text
   ============================================================ */
function LAST_YEAR(chart){ const L=chart.data.labels||[]; return L.length?L[L.length-1]:2025; }

const vlinePlugin = {
  id: 'vlines',

  beforeDatasetsDraw(chart, args, opts){
    const {ctx, chartArea, scales:{x}} = chart;
    if(!chartArea || !x) return;
    const alpha = (opts && opts.bandAlpha) || {blue:0.20, green:0.22};
    const labels = chart.data.labels || [];
    const px = (yr)=>{ const idx = labels.indexOf(yr); return idx < 0 ? null : x.getPixelForValue(idx); };
    const LAST = labels.length ? labels[labels.length-1] : 2025;   // self-adjusting end year
    const x2007 = px(2007), x2016 = px(2016), x2025 = px(LAST);
    if(x2007 === null || x2016 === null) return;
    ctx.save();
    // Blue era 2007-2016
    ctx.fillStyle = `rgba(45, 126, 180, ${alpha.blue})`;
    ctx.fillRect(x2007, chartArea.top, x2016 - x2007, chartArea.bottom - chartArea.top);
    // Green era 2016-2025
    if(x2025 !== null){
      ctx.fillStyle = `rgba(79, 157, 93, ${alpha.green})`;
      ctx.fillRect(x2016, chartArea.top, x2025 - x2016 + 18, chartArea.bottom - chartArea.top);
    }
    // Crisp top edge rules so the band boundaries read clearly without
    // darkening the whole field.
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(45,126,180,0.55)';
    ctx.beginPath(); ctx.moveTo(x2007, chartArea.top); ctx.lineTo(x2016, chartArea.top); ctx.stroke();
    if(x2025 !== null){
      ctx.strokeStyle = 'rgba(79,157,93,0.55)';
      ctx.beginPath(); ctx.moveTo(x2016, chartArea.top); ctx.lineTo(x2025 + 18, chartArea.top); ctx.stroke();
    }
    ctx.restore();
  },

  // Draw annotations AFTER datasets (above the lines) - and, crucially,
  // before Chart.js paints the tooltip in afterDraw, so a canvas tooltip
  // would sit on top. (Fig 1 also uses an HTML tooltip, which is always
  // in front regardless.)
  afterDatasetsDraw(chart, args, opts){
    const ev = (opts && opts.events) || [];
    const S  = (opts && opts.fs) || 1;
    const {ctx, chartArea, scales:{x,y}} = chart;
    if(!chartArea || chartArea.width < 5 || !x) return;
    const labels = chart.data.labels || [];
    const px = (yr)=>{ const idx = labels.indexOf(yr); return idx < 0 ? null : x.getPixelForValue(idx); };
    const clampX = (v)=>Math.max(chartArea.left+2, Math.min(chartArea.right-2, v));

    function haloText(text, tx, ty, color='#17324D', align='center', size=12){
      ctx.save();
      ctx.font = `800 ${size}px "Source Sans 3", sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size*0.38);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,.98)';
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = color;
      ctx.fillText(text, tx, ty);
      ctx.restore();
    }

    // `lines` may be a string or an array of strings (stacked, last line at textY).
    function eraLabel({lines, start, end, textY, bracketY, color, size}){
      const x1 = px(start), x2 = px(end);
      if(x1 === null || x2 === null) return;
      const left = Math.max(chartArea.left, Math.min(x1, x2));
      const right = Math.min(chartArea.right, Math.max(x1, x2));
      const cxBand = (left + right) / 2;
      // bracket under the band
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.82;
      ctx.lineWidth = 1.65*S;
      ctx.moveTo(left + 3, bracketY);
      ctx.lineTo(right - 3, bracketY);
      ctx.moveTo(left + 3, bracketY);
      ctx.lineTo(left + 3, bracketY + 6*S);
      ctx.moveTo(right - 3, bracketY);
      ctx.lineTo(right - 3, bracketY + 6*S);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      // stacked lines: bottom line baseline at textY, earlier lines above it
      const arr = Array.isArray(lines) ? lines : [lines];
      const lineH = size * 1.16;
      ctx.save();
      ctx.font = `800 ${size}px "Source Sans 3", sans-serif`;
      arr.forEach((ln, i)=>{
        const yy = textY - (arr.length - 1 - i) * lineH;
        const w = ctx.measureText(ln).width;
        const cx = Math.max(chartArea.left + w/2 + 3, Math.min(chartArea.right - w/2 - 3, cxBand));
        haloText(ln, cx, yy, color, 'center', size);
      });
      ctx.restore();
    }

    ctx.save();
    const T = chartArea.top;
    const gold = '#8A6A18', blue = '#1C5E8C', green = '#2F7A38', purple = '#7A3E9D';
    const eSize = CUM_BASE.era*S;

    eraLabel({lines:['Ozone Protection Only'], start:1985, end:2007,
      textY:T - 56*S, bracketY:T - 39*S, color:gold, size:eSize});
    eraLabel({lines:['Transition to Ozone','and Climate'], start:2007, end:2016,
      textY:T - 56*S, bracketY:T - 39*S, color:blue, size:eSize});
    eraLabel({lines:['Ozone and Climate','Protection'], start:2016, end:LAST_YEAR(chart),
      textY:T - 56*S, bracketY:T - 39*S, color:green, size:eSize});

    const requested = ev.filter(item => {
      const yr = item.year ?? item[0]; const label = String(item.label ?? item[1]);
      return (yr === 1990 && label.includes('London Adjustment')) ||
             yr === 2007 || yr === 2009 || yr === 2023 || yr === 2026;
    });
    requested.forEach((item)=>{
      const yr = item.year ?? item[0]; const label = item.label ?? item[1];
      const type = item.type ?? item[2] ?? 'event';
      const xp0 = px(yr); if(xp0 === null) return;
      const xp = clampX(xp0);
      const isBlueBar = type === 'bluebar' || yr === 2007;
      // 'solid' = a thinner solid marker (2009 universal ratification, 2026 Kigali +10)
      const isSolid  = type === 'solid';
      const solidCol = (yr === 2026) ? '#B0392B' : '#1C5E8C';
      if(isBlueBar){
        ctx.fillStyle = 'rgba(29, 95, 120, 0.94)';
        ctx.fillRect(xp - 3.4*S, chartArea.top, 6.8*S, chartArea.bottom - chartArea.top);
      }else if(isSolid){
        ctx.fillStyle = solidCol;
        ctx.fillRect(xp - 1.6*S, chartArea.top, 3.2*S, chartArea.bottom - chartArea.top);
      }else{
        ctx.beginPath(); ctx.setLineDash([5,5]); ctx.strokeStyle = 'rgba(154,140,106,0.88)';
        ctx.lineWidth = 1.25*S; ctx.moveTo(xp, chartArea.top); ctx.lineTo(xp, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]);
      }
      let pretty = String(label)
        .replace('London Adjustment (first use of the adjustment mechanism)', 'London Adjustment')
        .trim();

      ctx.save();
      const isMLF = yr === 2023;
      const exp = !!(opts && opts.exportMode);
      const pad = 6*S;
      if(isMLF){
        const lines = ['$1B MLF replenishment', '+ Decision XXXV/13 (Stop Dumping)'];
        const rsize = exp ? CUM_EXPORT.mlf : CUM_BASE.mlf*S;
        ctx.font = `800 ${rsize}px "Source Sans 3", sans-serif`;
        const w = Math.max(...lines.map(l=>ctx.measureText(l).width));
        // reads upward from near the bottom; keep the whole label inside the plot
        let anchorY = chartArea.bottom - 8*S;
        if(anchorY - w < chartArea.top + pad) anchorY = chartArea.top + pad + w;
        anchorY = Math.min(anchorY, chartArea.bottom - pad);
        ctx.translate(xp, anchorY);
        ctx.rotate(-Math.PI/2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        lines.forEach((ln,i)=>{
          const off = (i===0)? -7*S : 7*S;
          ctx.lineWidth = 4.5; ctx.lineJoin='round'; ctx.strokeStyle='rgba(255,255,255,0.97)';
          ctx.strokeText(ln, 0, off); ctx.fillStyle='#57482A'; ctx.fillText(ln, 0, off);
        });
      }else{
        const bold = isBlueBar || isSolid;
        const rsize = exp
          ? (bold ? CUM_EXPORT.rotBlue : CUM_EXPORT.rot)
          : (bold ? CUM_BASE.blueBar*S : CUM_BASE.marker*S);
        ctx.font = `800 ${rsize}px "Source Sans 3", sans-serif`;
        const w = ctx.measureText(pretty).width;
        // reads upward; spans [yy, yy+w]. Clamp so the bottom never crosses the axis.
        let yy = bold ? chartArea.top + 112*S : chartArea.top + 150*S;
        // the 2009 star sits above this marker; start its label lower so the
        // star and its halo never cover the text
        if(yr === 2009) yy += 40*S;
        yy = Math.min(yy, chartArea.bottom - pad - w);
        yy = Math.max(yy, chartArea.top + pad);
        // Near the right edge (e.g. the 2026 marker) put the label on the inside
        // of the line so it can't be clipped by the plot boundary.
        const nearRight = xp > chartArea.right - 40*S;
        const dx = bold ? (nearRight ? -10*S : 8*S) : (nearRight ? -8*S : 0);
        ctx.translate(xp + dx, yy);
        ctx.rotate(-Math.PI/2);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4.5; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.97)'; ctx.strokeText(pretty, 0, 0);
        ctx.fillStyle = isBlueBar ? '#0B5C8A' : (isSolid ? solidCol : '#57482A');
        ctx.fillText(pretty, 0, 0);
      }
      ctx.restore();
    });

    // Star marks 2009 (universal ratification of the VC and the MP). No caption:
    // the 2009 marker line beneath it carries the label.
    const xStar = px(2009);
    if(xStar !== null && y){
      const sx = clampX(xStar);
      // Sit just above the saturated curves so nothing appears to run through it.
      const sy = Math.max(chartArea.top + 15*S,
                 Math.min(chartArea.bottom - 48, y.getPixelForValue(203)));
      const g = CUM_BASE.starGlyph*S;
      ctx.save();
      ctx.font = `${g}px "Source Sans 3", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Explicit white halo: drawn last, so it cleanly separates the star from
      // the marker line and the curves behind it.
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = g*0.26;
      ctx.strokeText('\u2605', sx, sy);
      ctx.fillStyle = '#B8902A'; ctx.fillText('\u2605', sx, sy);
      ctx.restore();
    }

    ctx.restore();

    // Export-only chrome: title / subtitle / source / on-canvas legend.
    if(opts && opts.exportMode) drawExportChrome(chart, opts);
  }
};

/* On-canvas title + legend + source for the landscape print export. */
function drawExportChrome(chart, opts){
  const ctx = chart.ctx, W = chart.width, H = chart.height, area = chart.chartArea;
  const E = CUM_EXPORT;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const textAvail = W - E.padLeft - E.padRight - 12;
  // Title — shrink to fit the print width so it's never clipped
  if(opts.title){
    let ts = E.title;
    ctx.font = `700 ${ts}px "Playfair Display", serif`;
    while(ctx.measureText(opts.title).width > textAvail && ts > E.titleMin){
      ts -= 0.5; ctx.font = `700 ${ts}px "Playfair Display", serif`;
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#17324D';
    ctx.fillText(opts.title, E.padLeft + 6, 30);
  }
  if(opts.subtitle){
    let ss = E.subtitle;
    ctx.font = `400 ${ss}px "Source Sans 3", sans-serif`;
    while(ctx.measureText(opts.subtitle).width > textAvail && ss > E.subtitleMin){
      ss -= 0.5; ctx.font = `400 ${ss}px "Source Sans 3", sans-serif`;
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#697386';
    ctx.fillText(opts.subtitle, E.padLeft + 6, 50);
  }
  // Source note bottom-left
  if(opts.source){
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8a8478';
    ctx.font = `italic 400 ${E.source}px "Source Sans 3", sans-serif`;
    ctx.fillText(opts.source, E.padLeft + 6, H - 14);
  }
  // Legend row(s) just above the source note.
  const items = chart.data.datasets.map(d=>({
    label:d.label, color:d.borderColor,
    dash:(d.borderDash && d.borderDash.length)>0
  }));
  ctx.font = `700 ${E.legendFont}px "Source Sans 3", sans-serif`;
  const gap = 26, txtGap = 9;
  const widthOf = it => E.legendBarW + txtGap + ctx.measureText(it.label).width;
  const avail = area.right - area.left;
  // Greedy wrap into rows.
  const rows = [[]]; let rowW = 0;
  items.forEach(it=>{
    const w = widthOf(it);
    if(rowW + w > avail && rows[rows.length-1].length){ rows.push([]); rowW = 0; }
    rows[rows.length-1].push(it); rowW += w + gap;
  });
  const rowH = E.legendBarH + 16;
  let baseY = H - 30 - (rows.length-1)*rowH;
  rows.forEach(row=>{
    const total = row.reduce((s,it)=>s+widthOf(it),0) + gap*(row.length-1);
    let cx = area.left + (avail - total)/2;
    row.forEach(it=>{
      const by = baseY - E.legendBarH;
      if(it.dash){
        // dashed bar for Kigali - preserves its on-chart cue
        const seg = 9, gapp = 6; let px2 = cx;
        ctx.fillStyle = it.color;
        while(px2 < cx + E.legendBarW){
          ctx.fillRect(px2, by, Math.min(seg, cx+E.legendBarW-px2), E.legendBarH);
          px2 += seg + gapp;
        }
      }else{
        ctx.fillStyle = it.color;
        roundRect(ctx, cx, by, E.legendBarW, E.legendBarH, 3); ctx.fill();
      }
      ctx.fillStyle = '#2b3a4d';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(it.label, cx + E.legendBarW + txtGap, by + E.legendBarH/2);
      cx += widthOf(it) + gap;
    });
    baseY += rowH;
  });
  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

/* ---------- Figure 1 dataset builder (shared by live + export) ---------- */
function cumDatasets(){
  const cum = D.cumulative;
  return Object.keys(cum.series).map(name=>{
    const kig=name.includes("Kigali"), vie=name.includes("Vienna");
    return {
      label:name, data:cum.series[name].data,
      borderColor:INST_COLORS[name], backgroundColor:INST_COLORS[name],
      borderWidth:(kig||vie)?3.2:2.2, borderDash:kig?[7,4]:[],
      pointRadius:0, pointHoverRadius:5, tension:0.25, spanGaps:true
    };
  });
}
function cumEvents(){
  return D.milestones
    .filter(m => (m[0]===1990 && String(m[1]).includes('London Adjustment')) ||
                 m[0]===2007 || m[0]===2009 || m[0]===2023 || m[0]===2026)
    .map(m=>({year:m[0],label:m[1],type:m[2]}));
}

/* ---------- Figure 1 HTML tooltip (always in front of the canvas) ---------- */
function cumTipHandler(context){
  const {chart, tooltip} = context;
  const tip = document.getElementById('cumTip');
  if(!tip) return;
  if(!tooltip || tooltip.opacity === 0){ tip.style.opacity = 0; return; }
  const title = (tooltip.title && tooltip.title.length) ? tooltip.title[0] : '';
  let rows = '';
  (tooltip.dataPoints||[]).forEach(dp=>{
    const c = dp.dataset.borderColor;
    rows += `<div class="tt-row"><span class="tt-sw" style="background:${c}"></span>`+
            `<span class="tt-nm">${dp.dataset.label}</span>`+
            `<span class="tt-vl">${dp.formattedValue}</span></div>`;
  });
  tip.innerHTML = `<div class="tt-hd">${title}</div>${rows}`;
  tip.style.opacity = 1;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = tooltip.caretX + 18, top = tooltip.caretY - th/2;
  if(left + tw > chart.width) left = tooltip.caretX - tw - 18;
  if(left < 4) left = 4;
  if(top < 4) top = 4;
  if(top + th > chart.height) top = chart.height - th - 4;
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}

/* ---------- Figure 1 custom HTML legend (screen) ---------- */
function buildCumLegend(chart){
  const box = document.getElementById('cumLegend');
  if(!box) return;
  box.innerHTML = '';
  chart.data.datasets.forEach((ds,i)=>{
    const dash = (ds.borderDash && ds.borderDash.length) ? ' dash' : '';
    const item = document.createElement('button');
    item.className = 'cl-item';
    item.type = 'button';
    item.setAttribute('aria-pressed','true');
    item.innerHTML = `<span class="cl-bar${dash}" style="--c:${ds.borderColor}"></span>`+
                     `<span class="cl-lb">${ds.label}</span>`;
    item.addEventListener('click', ()=>{
      const vis = chart.isDatasetVisible(i);
      chart.setDatasetVisibility(i, !vis);
      item.classList.toggle('off', vis);
      item.setAttribute('aria-pressed', String(!vis));
      chart.update();
    });
    box.appendChild(item);
  });
}

/* Apply a font tier to the live Figure-1 chart (screen vs card-export). */
function applyCumFonts(chart, fs){
  const b = CUM_BASE, o = chart.options;
  o.plugins.vlines.fs = fs;
  o.scales.x.ticks.font = {family:'Source Sans 3', size:b.tick*fs};
  o.scales.x.title.font = {family:'Source Sans 3', size:b.axisTitle*fs, weight:'600'};
  o.scales.y.ticks.font = {family:'Source Sans 3', size:b.tick*fs};
  o.scales.y.title.font = {family:'Source Sans 3', size:b.axisTitle*fs, weight:'600'};
  o.layout.padding.top = Math.round(84*fs + 40);
  chart.update('none');
}

/* ---------- 01 cumulative (live) ---------- */
function buildCum(){
  if(cumBuilt) return; cumBuilt = true;
  const cum = D.cumulative;
  cumChart = new Chart(document.getElementById('cumChart'),{
    type:'line',
    data:{labels:cum.years, datasets:cumDatasets()},
    plugins:[vlinePlugin],
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:1400,easing:'easeOutCubic'},
      interaction:{mode:'index',intersect:false},
      layout:{padding:{top:148,right:14,left:6,bottom:6}},
      plugins:{
        vlines:{events:cumEvents(), fs:CONFIG.FS_SCREEN, bandAlpha:{blue:0.20, green:0.22}},
        legend:{display:false},                 // replaced by the HTML legend
        tooltip:{
          enabled:false, external:cumTipHandler,
          callbacks:{title:i=>'Year '+i[0].label}
        }
      },
      scales:{
        x:{grid:{color:'rgba(0,0,0,0.04)'},
          ticks:{maxTicksLimit:14,color:'#6b7686',font:{family:'Source Sans 3'}},
          title:{display:true,text:'Year',color:'#5a6472'}},
        y:{beginAtZero:true,max:210,grid:{color:'rgba(0,0,0,0.06)'},
          ticks:{color:'#6b7686',font:{family:'Source Sans 3'}},
          title:{display:true,text:'Cumulative parties',color:'#5a6472'}}
      }
    }
  });
  applyCumFonts(cumChart, CONFIG.FS_SCREEN);
  buildCumLegend(cumChart);
}

/* ---------- 01 cumulative - LANDSCAPE print export (native high-DPI) ---------- */
async function dlLandscape(){
  const [win,hin] = CONFIG.LANDSCAPE_IN;
  const cssW = Math.round(win*96), cssH = Math.round(hin*96);
  const dpr  = CONFIG.PRINT_DPI/96;
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${cssW}px;height:${cssH}px;background:#fff;`;
  const cv = document.createElement('canvas');
  holder.appendChild(cv); document.body.appendChild(holder);

  const cum = D.cumulative;
  const E = CUM_EXPORT;
  const ch = new Chart(cv,{
    type:'line',
    data:{labels:cum.years, datasets:cumDatasets()},
    plugins:[vlinePlugin],
    options:{
      responsive:true, maintainAspectRatio:false, animation:false, devicePixelRatio:dpr,
      interaction:{mode:'index',intersect:false},
      layout:{padding:{top:E.padTop, right:E.padRight, left:E.padLeft, bottom:E.padBottom}},
      plugins:{
        vlines:{
          events:cumEvents(), fs:E.fs, bandAlpha:{blue:0.24, green:0.26},
          exportMode:true,
          // Titles, descriptive text and the source line are deliberately omitted
          // from exports so they can be added in Word alongside the figure.
          title:'', subtitle:'', source:''
        },
        legend:{display:false},
        tooltip:{enabled:false}
      },
      scales:{
        x:{grid:{color:'rgba(0,0,0,0.05)'},
          ticks:{maxTicksLimit:14,color:'#5a6472',font:{family:'Source Sans 3',size:E.tick}},
          title:{display:true,text:'Year',color:'#4a5462',font:{family:'Source Sans 3',size:E.axisTitle,weight:'600'}}},
        y:{beginAtZero:true,max:210,grid:{color:'rgba(0,0,0,0.07)'},
          ticks:{color:'#5a6472',font:{family:'Source Sans 3',size:E.tick}},
          title:{display:true,text:'Cumulative parties',color:'#4a5462',font:{family:'Source Sans 3',size:E.axisTitle,weight:'600'}}}
      }
    }
  });
  try{
    await settlePaint(3);
    ch.resize(); ch.draw();
    await settlePaint(2);
    await canvasToDownload(cv, 'cumulative_landscape_print');
  }catch(err){
    console.error('Landscape export failed', err);
    alert('Landscape export failed - try again once the page has finished loading.');
  }finally{
    ch.destroy(); holder.remove();
  }
}

/* ---------- 02 ratifications small multiples ---------- */
function ratifSeries(name){
  const d = D.ratif[name];
  const yrsSet = new Set([...Object.keys(d.A5),...Object.keys(d.nonA5)].map(Number));
  const arr = [...yrsSet].sort((a,b)=>a-b);
  const start = arr[0]-3, end = arr[arr.length-1]+3;
  const years=[]; for(let y=start;y<=end;y++) years.push(y);
  const non = years.map(y=>d.nonA5[y]||0);
  const a5  = years.map(y=>d.A5[y]||0);
  const [dark,light] = PAIRS[name];
  return {years, non, a5, dark, light};
}
function buildRatif(){
  if(ratifBuilt) return; ratifBuilt = true;
  const grid=document.getElementById('smGrid');
  ORDER.forEach(name=>{
    const panel=document.createElement('div');panel.className='sm-panel';
    panel.innerHTML=`<div class="sm-head"><h4>${name}</h4>`+
      `<button class="mini-dl" type="button" title="Download this instrument as a PNG">\u2193 PNG</button></div>`+
      `<div class="sm-cv"><canvas></canvas></div>`;
    grid.appendChild(panel);
    panel.querySelector('.mini-dl').addEventListener('click', ()=>dlRatifPanel(name));

    const {years,non,a5,dark,light}=ratifSeries(name);
    const chart = new Chart(panel.querySelector('canvas'),{
      type:'bar',
      data:{labels:years,datasets:[
        {label:'non-A5',data:non,backgroundColor:dark,stack:'s'},
        {label:'A5',data:a5,backgroundColor:light,stack:'s'}]},
      options:{responsive:true,maintainAspectRatio:false,
        animation:{duration:1000,easing:'easeOutQuart'},
        plugins:{legend:{display:true,labels:{boxWidth:12,boxHeight:12,font:{size:12,family:'Source Sans 3'}}},
          tooltip:{backgroundColor:'#17324D'}},
        scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:8,font:{size:11},color:'#7c8494'}},
          y:{stacked:true,max:35,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:11},color:'#7c8494'}}}}
    });
    ratifCharts.push({name, chart});
  });
  applyStagger();
}

/* Per-instrument print export for Fig 2 - native high-DPI, self-contained. */
async function dlRatifPanel(name){
  const {years,non,a5,dark,light}=ratifSeries(name);
  const [win,hin]=CONFIG.PANEL_IN;
  const cssW=Math.round(win*96), cssH=Math.round(hin*96), dpr=CONFIG.PRINT_DPI/96;
  const holder=document.createElement('div');
  holder.style.cssText=`position:fixed;left:-100000px;top:0;width:${cssW}px;height:${cssH}px;background:#fff;`;
  const cv=document.createElement('canvas');
  holder.appendChild(cv); document.body.appendChild(holder);

  const ch=new Chart(cv,{
    type:'bar',
    data:{labels:years,datasets:[
      {label:'non-Article 5 (developed)',data:non,backgroundColor:dark,stack:'s'},
      {label:'Article 5 (developing)',data:a5,backgroundColor:light,stack:'s'}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,devicePixelRatio:dpr,
      layout:{padding:{top:10,right:18,left:10,bottom:10}},
      plugins:{
        title:{display:true,text:name,color:'#17324D',
          font:{size:23,weight:'700',family:'Playfair Display'},padding:{bottom:2}},
        subtitle:{display:true,text:'Ratifications per year \u00b7 darker = non-Article 5, lighter = Article 5',
          color:'#697386',font:{size:13,family:'Source Sans 3'},padding:{bottom:14}},
        legend:{display:true,position:'top',align:'end',
          labels:{boxWidth:24,boxHeight:14,font:{size:14,family:'Source Sans 3'},padding:14}},
        tooltip:{enabled:false}
      },
      scales:{
        x:{stacked:true,grid:{display:false},
          ticks:{maxTicksLimit:12,font:{size:12,family:'Source Sans 3'},color:'#5a6472'}},
        y:{stacked:true,max:35,grid:{color:'rgba(0,0,0,0.06)'},
          ticks:{font:{size:12,family:'Source Sans 3'},color:'#5a6472'},
          title:{display:true,text:'Ratifications',font:{size:14,family:'Source Sans 3'},color:'#5a6472'}}
      }
    }
  });
  try{
    await settlePaint(3); ch.resize(); ch.draw(); await settlePaint(2);
    await canvasToDownload(cv, 'ratifications_'+slug(name));
  }catch(err){
    console.error('Ratif panel export failed', err);
    alert('That instrument PNG failed to export - try again in a moment.');
  }finally{
    ch.destroy(); holder.remove();
  }
}

/* ---------- 03 first 30 ---------- */
function buildF30(){
  const box=document.getElementById('f30list');
  D.first30.forEach(r=>{
    const row=document.createElement('div');row.className='row';
    const badge=r.a5==='A5'?'<span class="bd a5">A5</span>':'<span class="bd non">NON-A5</span>';
    row.innerHTML=`<span class="rk">${r.rank}</span><span class="dt">${r.date}</span>`+
      `<span class="nm">${r.country}</span>${badge}`;
    box.appendChild(row);
  });
}

/* ---------- 04 map ---------- */
function buildMap(){
  if(mapBuilt) return; mapBuilt = true;
  const rows=D.kigali_map;
  return Plotly.newPlot('mapDiv',[{
    type:'choropleth',
    locations:rows.map(r=>r.iso),
    z:rows.map(r=>r.year),
    text:rows.map(r=>`${r.name}<br>Joined: ${r.date}<br>Year: ${r.year}`),
    hoverinfo:'text',
    colorscale:[[0,'#1A4C7C'],[0.25,'#3A8FA8'],[0.45,'#52C4C9'],[0.6,'#7BC47F'],
                [0.78,'#E8C547'],[0.9,'#D98A3D'],[1,'#B0392B']],
    zmin:2017,zmax:2026,
    marker:{line:{color:'#fff',width:0.4}},
    colorbar:{title:{text:'Year joined',font:{family:'Source Sans 3',size:16}},
      tickfont:{family:'Source Sans 3',size:14},
      tickvals:[2017,2018,2019,2020,2021,2022,2023,2024,2025,2026],
      tickformat:'d',len:0.8,thickness:20,outlinewidth:0}
  }],{
    geo:{projection:{type:'natural earth'},showframe:false,showocean:false,
      showland:true,landcolor:'#F0EBE0',coastlinecolor:'#CCC',coastlinewidth:0.4,
      lataxis:{range:[-58,85]},lonaxis:{range:[-170,190]},center:{lon:10},bgcolor:'#FBF8F3'},
    paper_bgcolor:'#FBF8F3',
    margin:{l:8,r:8,t:8,b:8},
    height:600,
    font:{family:'Source Sans 3',size:15}
  },{
    responsive:true,
    displaylogo:false,
    modeBarButtonsToRemove:['lasso2d','select2d','pan2d'],
    toImageButtonOptions:{format:'png',filename:'kigali_map_only',scale:4}
  });
}

/* ---------- 05 top10 ---------- */
function buildTop10(){
  const grid=document.getElementById('t10grid');
  Object.entries(D.top10).forEach(([inst,rows])=>{
    const card=document.createElement('div');card.className='t10-card';
    card.dataset.inst=inst;
    let h=`<button class="mini-dl" type="button" title="Download this instrument as a PNG">\u2193 PNG</button><h4>${inst}</h4>`;
    rows.forEach((r,i)=>{h+=`<div class="r"><span class="k">${i+1}</span>`+
      `<span class="fl">${flagFor(r)}</span><span class="n">${r.country}</span>`+
      `<span class="d">${r.date}</span></div>`;});
    card.innerHTML=h;
    card.querySelector('.mini-dl').addEventListener('click', ()=>dlT10(inst));
    grid.appendChild(card);
  });
}

/* ---------- shared off-screen HTML export helpers ----------
   Never mutate the live dashboard while exporting. This avoids:
   - Plotly colorbar/legend jumping during card4 export
   - table/list spacing changing during card3/card5 export
*/
async function waitForImages(root){
  const imgs=[...root.querySelectorAll('img')];
  await Promise.all(imgs.map(img=>{
    if(img.complete && img.naturalWidth) return Promise.resolve();
    if(img.decode) return img.decode().catch(()=>{});
    return new Promise(resolve=>{
      img.onload=resolve; img.onerror=resolve;
    });
  }));
}

function stripExportButtons(root){
  root.querySelectorAll('.dl-btn,.mini-dl').forEach(btn=>btn.remove());
}

/* Exports carry the figure only. The card heading, the descriptive line under it
   and the source/footnote stay on the website but are removed from the download,
   so they can be typeset in Word instead. */
function stripExportChrome(root){
  root.querySelectorAll(':scope > h3, :scope > .sub, :scope > .foot').forEach(n=>n.remove());
}

function snapshotCanvases(el){
  return [...el.querySelectorAll('canvas')].map(cv=>{
    let src=null;
    try{ src=cv.toDataURL('image/png'); }catch(e){}
    const r=cv.getBoundingClientRect();
    return {src,w:Math.max(1,Math.round(r.width)),h:Math.max(1,Math.round(r.height))};
  });
}

function applyCanvasSnapshots(clone, shots){
  [...clone.querySelectorAll('canvas')].forEach((cv,i)=>{
    const shot=shots[i];
    if(!shot || !shot.src) return;
    const img=document.createElement('img');
    img.src=shot.src;
    img.style.width=shot.w+'px';
    img.style.height=shot.h+'px';
    img.style.display='block';
    cv.replaceWith(img);
  });
}

async function snapshotPlotlyMapForCard(cardId){
  if(cardId!=='card4' || !window.Plotly) return null;
  const mapDiv=document.getElementById('mapDiv');
  if(!mapDiv) return null;

  try{
    await Plotly.Plots.resize(mapDiv);
    await settlePaint(2);
    const r=mapDiv.getBoundingClientRect();
    const w=Math.max(1,Math.round(r.width));
    const h=Math.max(1,Math.round(r.height));

    // Use Plotly's native export engine, same family as the camera button,
    // so the colorbar/legend is preserved perfectly.
    const src=await Plotly.toImage(mapDiv,{
      format:'png',
      scale:CONFIG.CARD_SCALE,
      width:w,
      height:h
    });
    return {src,w,h};
  }catch(e){
    console.warn('Plotly map snapshot failed:', e);
    return null;
  }
}

function applyPlotlyMapSnapshot(clone, mapShot){
  if(!mapShot) return;
  const clonedMap=clone.querySelector('#mapDiv');
  if(!clonedMap) return;

  const img=document.createElement('img');
  img.src=mapShot.src;
  img.style.width=mapShot.w+'px';
  img.style.height=mapShot.h+'px';
  img.style.display='block';
  img.style.maxWidth='100%';

  clonedMap.innerHTML='';
  clonedMap.appendChild(img);
}

async function captureClone(el, fname, opts={}){
  const scale=opts.scale || CONFIG.CARD_SCALE;
  const width=Math.ceil(el.getBoundingClientRect().width || el.offsetWidth || 1180);

  const clone=el.cloneNode(true);
  clone.classList.add('export-freeze');
  if(opts.big) clone.classList.add('export-big');
  clone.style.width=width+'px';
  clone.style.maxWidth=width+'px';
  clone.style.transform='none';
  clone.style.margin='0';

  stripExportButtons(clone);
  stripExportChrome(clone);
  if(opts.canvasShots) applyCanvasSnapshots(clone, opts.canvasShots);
  if(opts.mapShot) applyPlotlyMapSnapshot(clone, opts.mapShot);

  const holder=document.createElement('div');
  holder.style.position='fixed';
  holder.style.left='-100000px';
  holder.style.top='0';
  holder.style.width=width+'px';
  holder.style.background='#fff';
  holder.style.zIndex='-1';
  holder.appendChild(clone);
  document.body.appendChild(holder);

  try{
    await waitForImages(clone);
    await settlePaint(2);
    const canvas=await html2canvas(clone,{
      backgroundColor:'#FFFFFF',
      scale,
      useCORS:true,
      allowTaint:true,
      logging:false,
      scrollX:0,
      scrollY:0,
      windowWidth:width
    });
    await canvasToDownload(canvas, fname);
  }finally{
    holder.remove();
  }
}

/* Per-instrument print export for Fig 5 - HTML list captured at high scale. */
async function dlT10(inst){
  const card=[...document.querySelectorAll('.t10-card')].find(c=>c.dataset.inst===inst);
  if(!card) return;

  try{
    await captureClone(card, 'first10_'+slug(inst), {
      scale:CONFIG.LIST_SCALE,
      big:false
    });
  }catch(err){
    console.error('First-10 export failed', err);
    alert('That instrument PNG failed to export - try again in a moment.');
  }
}

/* ---------- whole-card PNG (convenience / electronic) ----------
   Captures an off-screen clone of the card. The live dashboard is never
   modified, so no flicker, spacing shift, or Plotly legend jump occurs. */
async function ensureBuilt(cardId){
  if(cardId==='card1') buildCum();
  if(cardId==='card2') buildRatif();
  if(cardId==='card4') return buildMap();
}

async function dl(cardId,fname){
  const el=document.getElementById(cardId);
  if(!el) return;

  await ensureBuilt(cardId);
  await settlePaint(3);

  // Snapshot dynamic renderers from the live view first.
  // Then only the clone is modified and captured.
  const canvasShots=snapshotCanvases(el);
  const mapShot=await snapshotPlotlyMapForCard(cardId);

  try{
    await captureClone(el, fname, {
      scale:CONFIG.CARD_SCALE,
      big:true,
      canvasShots,
      mapShot
    });
  }catch(err){
    console.error('PNG export failed',err);
    alert('PNG export failed. Try again after the figure finishes loading.');
  }
}
window.dl = dl;
window.dlLandscape = dlLandscape;

/* ============================================================
   SCROLL CHOREOGRAPHY
   ============================================================ */
function setupScroll(){
  const builders = { smGrid: buildRatif, mapDiv: buildMap };
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(!e.isIntersecting) return;
      const el = e.target;
      el.classList.add('in');
      if(el.id==='card1' && cumChart){
        requestAnimationFrame(()=>{ cumChart.resize(); cumChart.draw(); });
      }
      Object.keys(builders).forEach(id=>{
        if(el.id===id || el.querySelector?.('#'+id)){
          requestAnimationFrame(()=>requestAnimationFrame(builders[id]));
        }
      });
      obs.unobserve(el);
    });
  },{threshold:0.14, rootMargin:'0px 0px -8% 0px'});

  document.querySelectorAll('[data-anim],[data-stagger],.rule').forEach(el=>obs.observe(el));
  requestAnimationFrame(()=>document.querySelectorAll('.hero-kpis,[data-stagger]').forEach(el=>el.classList.add('in')));
}

function applyStagger(){
  document.querySelectorAll('[data-stagger]').forEach(group=>{
    [...group.children].forEach((child,i)=>{
      child.style.animationDelay = (i*65)+'ms';
    });
  });
}
function setupScrollEffects(){
  const update = ()=>{
    scrollTicking=false;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - innerHeight);
    const progress = Math.min(1, Math.max(0, scrollY / max));
    doc.style.setProperty('--page-progress', progress.toFixed(4));

    const heroShift = Math.min(46, scrollY * 0.08);
    const heroScale = 1 + Math.min(0.035, scrollY / 18000);
    doc.style.setProperty('--hero-shift', heroShift.toFixed(2));
    doc.style.setProperty('--hero-scale', heroScale.toFixed(4));

    document.querySelectorAll('.scroll-zoom').forEach(card=>{
      const r = card.getBoundingClientRect();
      const center = r.top + r.height/2;
      const dist = Math.abs(center - innerHeight/2) / innerHeight;
      const scale = 1 - Math.min(0.035, dist * 0.045);
      card.style.setProperty('--scroll-scale', scale.toFixed(4));
    });
  };
  const request = ()=>{
    if(!scrollTicking){ scrollTicking=true; requestAnimationFrame(update); }
  };
  addEventListener('scroll', request, {passive:true});
  addEventListener('resize', request);
  request();
}

/* ---------- init ---------- */
function fatal(msg){
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="padding:20px;color:#b00;font-family:sans-serif">'+msg+'</p>');
}
loadMasterWorkbook()
  .then(wb => {
    D = buildData(wb);
    hydrateNumbers();
    buildInsightCards();
    buildF30();
    buildTop10();
    applyStagger();
    setupScroll();
    setupScrollEffects();
    requestAnimationFrame(()=>requestAnimationFrame(buildCum));
  })
  .catch(err => {
    console.error(err);
    fatal('Could not load ' + MASTER_FILE + ' &mdash; ' + err.message +
          '<br>The page must be served over http (not opened as a file).');
  });
