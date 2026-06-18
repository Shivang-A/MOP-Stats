/* ============================================================
   Montreal Protocol Dashboard — app.js
   Loads data.json, builds figures, runs scroll animations + PNG export.
   ============================================================ */

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

let D = null;
let cumChart = null, cumBuilt = false, ratifBuilt = false, mapBuilt = false;
let scrollTicking = false;

/* ---------- helper utilities ---------- */
const wait = (ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const nextFrame = ()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
async function settlePaint(frames=2){
  if(document.fonts && document.fonts.ready) await document.fonts.ready.catch(()=>{});
  for(let i=0;i<frames;i++) await nextFrame();
}
function fmt(v){ return (typeof v === 'number') ? v.toLocaleString() : v; }

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

/* ---------- milestone vertical-line plugin ----------
   Uses collision-aware lanes and bolder labels so right-edge / crowded labels
   are readable when exported as PNG. */
const vlinePlugin = {
  id: 'vlines',
  afterDraw(chart, args, opts){
    const ev = (opts && opts.events) || [];
    if(!ev.length) return;
    const {ctx, chartArea, scales:{x}} = chart;
    if(!chartArea || chartArea.width < 5) return;
    const labels = chart.data.labels;
    const lanes = [];
    ctx.save();

    ev.forEach(([yr,label])=>{
      const idx = labels.indexOf(yr);
      if(idx < 0) return;
      const xp0 = x.getPixelForValue(idx);
      if(xp0 < chartArea.left - 2 || xp0 > chartArea.right + 2) return;
      const xp = Math.max(chartArea.left + 4, Math.min(chartArea.right - 4, xp0));

      ctx.beginPath();
      ctx.setLineDash([5,5]);
      ctx.strokeStyle = 'rgba(154,140,106,0.92)';
      ctx.lineWidth = 1.35;
      ctx.moveTo(xp, chartArea.top);
      ctx.lineTo(xp, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      const pretty = label
        .replace('US $1 Billion 3-yr replenishment budget pledge;','US $1B MLF replenishment')
        .replace('$1B MLF replenishment; Decision XXXV/13','$1B MLF replenishment')
        .replace('Narrow ODS/HFC Feedstock Exemptions (pending)','Narrow feedstock exemptions')
        .replace('Montreal Adjustment (accelerated HCFC phaseout)','Accelerated HCFC phaseout')
        .split('(')[0].split(';')[0].trim();

      ctx.font = '700 12px "Source Sans 3", sans-serif';
      const textW = ctx.measureText(pretty).width;
      const start = xp - textW - 10;
      const end = xp + 8;
      let lane = 0;
      while(lanes[lane] && !(end < lanes[lane].start || start > lanes[lane].end)) lane++;
      lanes[lane] = {start, end};
      const y = chartArea.top + 16 + lane * 16;

      ctx.save();
      ctx.translate(xp, y);
      ctx.rotate(-Math.PI/2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(pretty, 0, 0);
      ctx.fillStyle = '#57482A';
      ctx.fillText(pretty, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }
};

/* ---------- 01 cumulative ---------- */
function buildCum(){
  if(cumBuilt) return; cumBuilt = true;
  const cum = D.cumulative;
  const events = D.milestones.filter(m=>m[2]==="event").map(m=>[m[0],m[1]]);
  const datasets = Object.keys(cum.series).map(name=>{
    const kig=name.includes("Kigali"), vie=name.includes("Vienna");
    return {
      label:name,
      data:cum.series[name].data,
      borderColor:INST_COLORS[name],
      backgroundColor:INST_COLORS[name],
      borderWidth:(kig||vie)?3.2:2.2,
      borderDash:kig?[7,4]:[],
      pointRadius:0,
      pointHoverRadius:5,
      tension:0.25,
      spanGaps:true
    };
  });
  cumChart = new Chart(document.getElementById('cumChart'),{
    type:'line',
    data:{labels:cum.years,datasets},
    plugins:[vlinePlugin],
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:{duration:1400,easing:'easeOutCubic'},
      interaction:{mode:'index',intersect:false},
      layout:{padding:{top:118,right:12,left:4,bottom:4}},
      plugins:{
        vlines:{events:events},
        legend:{position:'bottom',labels:{font:{family:'Source Sans 3',size:12.5},
          usePointStyle:true,pointStyle:'line',padding:16}},
        tooltip:{backgroundColor:'#17324D',padding:12,cornerRadius:8,
          callbacks:{title:i=>'Year '+i[0].label}}
      },
      scales:{
        x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{maxTicksLimit:14,color:'#888',
          font:{family:'Source Sans 3'}},title:{display:true,text:'Year',color:'#666'}},
        y:{beginAtZero:true,max:210,grid:{color:'rgba(0,0,0,0.06)'},
          ticks:{color:'#888',font:{family:'Source Sans 3'}},
          title:{display:true,text:'Cumulative parties',color:'#666'}}
      }
    }
  });
}

/* ---------- 02 ratifications small multiples ---------- */
function buildRatif(){
  if(ratifBuilt) return; ratifBuilt = true;
  const grid=document.getElementById('smGrid');
  ORDER.forEach(name=>{
    const panel=document.createElement('div');panel.className='sm-panel';
    panel.innerHTML=`<h4>${name}</h4><div class="sm-cv"><canvas></canvas></div>`;
    grid.appendChild(panel);
    const d=D.ratif[name];
    const yrsSet=new Set([...Object.keys(d.A5),...Object.keys(d.nonA5)].map(Number));
    const arr=[...yrsSet].sort((a,b)=>a-b);
    const start=arr[0]-3, end=arr[arr.length-1]+3;
    const years=[];for(let y=start;y<=end;y++)years.push(y);
    const non=years.map(y=>d.nonA5[y]||0);
    const a5 =years.map(y=>d.A5[y]||0);
    const [dark,light]=PAIRS[name];
    new Chart(panel.querySelector('canvas'),{
      type:'bar',
      data:{labels:years,datasets:[
        {label:'non-A5',data:non,backgroundColor:dark,stack:'s'},
        {label:'A5',data:a5,backgroundColor:light,stack:'s'}]},
      options:{responsive:true,maintainAspectRatio:false,
        animation:{duration:1000,easing:'easeOutQuart'},
        plugins:{legend:{display:true,labels:{boxWidth:10,font:{size:10,family:'Source Sans 3'}}},
          tooltip:{backgroundColor:'#17324D'}},
        scales:{x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:8,font:{size:9},color:'#999'}},
          y:{stacked:true,max:35,grid:{color:'rgba(0,0,0,0.05)'},ticks:{font:{size:9},color:'#999'}}}}
    });
  });
  applyStagger();
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
  Plotly.newPlot('mapDiv',[{
    type:'choropleth',
    locations:rows.map(r=>r.iso),
    z:rows.map(r=>r.year),
    text:rows.map(r=>`${r.name}<br>Joined: ${r.date}<br>Year: ${r.year}`),
    hoverinfo:'text',
    colorscale:[[0,'#1A4C7C'],[0.25,'#3A8FA8'],[0.45,'#52C4C9'],[0.6,'#7BC47F'],
                [0.78,'#E8C547'],[0.9,'#D98A3D'],[1,'#B0392B']],
    zmin:2017,zmax:2026,
    marker:{line:{color:'#fff',width:0.4}},
    colorbar:{title:{text:'Year joined',font:{family:'Source Sans 3',size:13}},
      tickvals:[2017,2018,2019,2020,2021,2022,2023,2024,2025,2026],
      tickformat:'d',len:0.75,thickness:16,outlinewidth:0}
  }],{
    geo:{projection:{type:'natural earth'},showframe:false,showocean:false,
      showland:true,landcolor:'#F0EBE0',coastlinecolor:'#CCC',coastlinewidth:0.4,
      lataxis:{range:[-58,85]},lonaxis:{range:[-170,190]},center:{lon:10},bgcolor:'#FBF8F3'},
    paper_bgcolor:'#FBF8F3',
    margin:{l:8,r:8,t:8,b:8},
    height:600,
    font:{family:'Source Sans 3'}
  },{
    responsive:true,
    displaylogo:false,
    modeBarButtonsToRemove:['lasso2d','select2d','pan2d'],
    toImageButtonOptions:{format:'png',filename:'kigali_map_only',scale:2}
  });
}

/* ---------- 05 top10 ---------- */
function buildTop10(){
  const grid=document.getElementById('t10grid');
  Object.entries(D.top10).forEach(([inst,rows])=>{
    const card=document.createElement('div');card.className='t10-card';
    let h=`<h4>${inst}</h4>`;
    rows.forEach((r,i)=>{h+=`<div class="r"><span class="k">${i+1}</span>`+
      `<span class="fl">${r.flag}</span><span class="n">${r.country}</span>`+
      `<span class="d">${r.date}</span></div>`;});
    card.innerHTML=h;grid.appendChild(card);
  });
}

/* ---------- download as PNG ----------
   Captures the full card after freezing animations and replacing live canvases
   with static PNGs. Works for chart cards and the Plotly map card. */
function ensureBuilt(cardId){
  if(cardId==='card1') buildCum();
  if(cardId==='card2') buildRatif();
  if(cardId==='card4') buildMap();
}
function stopChartsInside(el){
  [...el.querySelectorAll('canvas')].forEach(cv=>{
    const ch = Chart.getChart(cv);
    if(ch){
      ch.stop();
      ch.update('none');
      ch.draw();
    }
  });
}
function swapCanvases(el){
  const swaps=[];
  [...el.querySelectorAll('canvas')].forEach(cv=>{
    let url;
    try{ url=cv.toDataURL('image/png'); }catch(e){ return; }
    const img=document.createElement('img');
    img.src=url;
    img.style.width=cv.clientWidth+'px';
    img.style.height=cv.clientHeight+'px';
    img.style.display='block';
    cv.style.display='none';
    cv.parentNode.insertBefore(img,cv);
    swaps.push({cv,img});
  });
  return ()=>swaps.forEach(s=>{ s.img.remove(); s.cv.style.display=''; });
}
async function dl(cardId,fname){
  const el=document.getElementById(cardId);
  if(!el) return;
  ensureBuilt(cardId);
  await settlePaint(3);

  if(cardId==='card4' && window.Plotly && document.getElementById('mapDiv')){
    try{
      await Plotly.Plots.resize('mapDiv');
      await settlePaint(2);
    }catch(e){}
  }

  const buttons=[...el.querySelectorAll('.dl-btn')];
  buttons.forEach(btn=>btn.style.visibility='hidden');
  el.classList.add('export-freeze');
  document.body.classList.add('exporting');
  stopChartsInside(el);
  await settlePaint(2);
  const restoreCanvases = swapCanvases(el);

  try{
    await settlePaint(2);
    const canvas = await html2canvas(el,{
      backgroundColor:'#FFFFFF',
      scale:2,
      useCORS:true,
      allowTaint:true,
      logging:false,
      scrollX:0,
      scrollY:-window.scrollY,
      windowWidth:document.documentElement.clientWidth
    });
    const a=document.createElement('a');
    a.download=fname+'.png';
    a.href=canvas.toDataURL('image/png');
    a.click();
  }catch(err){
    console.error('PNG export failed',err);
    alert('PNG export failed. Try again after the figure finishes loading.');
  }finally{
    restoreCanvases();
    el.classList.remove('export-freeze');
    document.body.classList.remove('exporting');
    buttons.forEach(btn=>btn.style.visibility='visible');
  }
}
window.dl = dl;

/* ============================================================
   SCROLL CHOREOGRAPHY
   IntersectionObserver reveals sections; scroll listener handles parallax,
   progress bar, and subtle zoom-in/out of cards.
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
    if(!scrollTicking){
      scrollTicking=true;
      requestAnimationFrame(update);
    }
  };
  addEventListener('scroll', request, {passive:true});
  addEventListener('resize', request);
  request();
}

/* ---------- init ---------- */
fetch('data.json').then(r=>r.json()).then(data=>{
  D = data;
  hydrateNumbers();
  buildInsightCards();
  buildF30();
  buildTop10();
  applyStagger();
  setupScroll();
  setupScrollEffects();
  requestAnimationFrame(()=>requestAnimationFrame(buildCum));
}).catch(err=>{
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="padding:20px;color:#b00">Could not load data.json — '+err+'</p>');
});
