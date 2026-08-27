/* ============================================================
   DATA LAYER — builds the dashboard's `D` object directly from
   MP-treaty-status-MASTER.xlsx.

   To update the dashboard after a new ratification you only edit
   the spreadsheet. Nothing in this file needs changing.

   Produces exactly the same shape the figures already consume:
     D.cumulative, D.milestones, D.ratif, D.first30,
     D.kigali_map, D.top10, D.summary
   ============================================================ */

const MASTER_FILE = 'MP-treaty-status-MASTER.xlsx';

/* Column stem in the spreadsheet  ->  name used by Figures 1 & 2 */
const INST_SHORT = {
  Vienna:'Vienna (1985)', MP:'MP (1987)', London:'London (1990)',
  Copenhagen:'Copenhagen (1992)', Montreal:'Montreal (1997)',
  Beijing:'Beijing (1999)', Kigali:'Kigali (2016)'
};
/* Column stem  ->  name used by Figure 5 (First 10 Parties to Ratify) */
const INST_LONG = {
  Vienna:'Vienna Convention (1985)', MP:'Montreal Protocol (1987)',
  London:'London Amendment (1990)', Copenhagen:'Copenhagen Amendment (1992)',
  Montreal:'Montreal Amendment (1997)', Beijing:'Beijing Amendment (1999)',
  Kigali:'Kigali Amendment (2016)'
};
const STEMS = ['Vienna','MP','London','Copenhagen','Montreal','Beijing','Kigali'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- date handling ----------
   The master file stores ISO text (YYYY-MM-DD). We still accept a real Excel
   date and the legacy "\u00a0M/D/YYYY " text form, so a hand-typed cell can
   never silently vanish the way it used to. */
function parseCell(v){
  if(v == null || v === '') return null;
  if(v instanceof Date && !isNaN(v)) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  const s = String(v).replace(/\u00a0/g,' ').trim();
  if(!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);        // legacy M/D/YYYY
  if(m) return new Date(Date.UTC(+m[3], +m[1]-1, +m[2]));
  const d = new Date(s);
  return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
const iso      = d => d.toISOString().slice(0,10);
const dMonY    = d => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const ddMonY   = d => `${String(d.getUTCDate()).padStart(2,'0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/* ---------- read the workbook ---------- */
function readParties(wb){
  const ws = wb.Sheets['Parties'];
  if(!ws) throw new Error('Sheet "Parties" not found in ' + MASTER_FILE);
  const rows = XLSX.utils.sheet_to_json(ws, {raw:true, cellDates:true, defval:null});
  return rows
    .filter(r => r.Country && String(r.Country).trim())
    .map(r => {
      const rec = {
        country: String(r.Country).trim(),
        iso2: (r.ISO2 || '').toString().trim(),
        iso3: (r.ISO3 || '').toString().trim(),
        a5:   String(r.Article5||'').trim().toLowerCase() === 'non-a5' ? 'NON-A5' : 'A5',
        inst: {}
      };
      STEMS.forEach(stem => {
        const d = parseCell(r[stem + '_Date']);
        if(d) rec.inst[stem] = { date:d, method:String(r[stem + '_Method']||'').trim() };
      });
      return rec;
    });
}
function readMilestones(wb){
  const ws = wb.Sheets['Milestones'];
  if(!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {raw:true, defval:null})
    .filter(r => r.Year && r.Label)
    .map(r => [Number(r.Year), String(r.Label).trim(), String(r.Type||'event').trim()]);
}

/* ---------- assemble D ---------- */
function buildData(wb){
  const P = readParties(wb);

  /* sanity: a country that can't be drawn on the map must be loud, not silent */
  const noIso = P.filter(p => !p.iso3 && p.country !== 'European Union').map(p=>p.country);
  if(noIso.length) console.warn('[data] no ISO3, will not appear on the map:', noIso);

  /* --- year axis --- */
  let minY = 9999, maxY = 0;
  P.forEach(p => STEMS.forEach(s => {
    const e = p.inst[s]; if(!e) return;
    const y = e.date.getUTCFullYear();
    if(y < minY) minY = y; if(y > maxY) maxY = y;
  }));
  /* The Figure-1 era brackets start at 1985 (adoption of the Vienna Convention),
     so the axis always begins there even though the first ratification is 1986. */
  minY = Math.min(minY, 1985);
  const years = []; for(let y = minY; y <= maxY; y++) years.push(y);

  /* --- Figure 1: cumulative parties (signature dates are NOT joining) --- */
  const cumulative = { years, series:{} };
  STEMS.forEach(stem => {
    const byYear = {};
    P.forEach(p => { const e = p.inst[stem]; if(e){
      const y = e.date.getUTCFullYear(); byYear[y] = (byYear[y]||0) + 1; } });
    let run = 0, started = false;
    const data = years.map(y => {
      if(byYear[y]) started = true;
      run += (byYear[y]||0);
      return started ? run : null;
    });
    cumulative.series[INST_SHORT[stem]] = { data, total: run };
  });

  /* --- Figure 2: ratifications per year, split A5 / non-A5 --- */
  const ratif = {};
  STEMS.forEach(stem => {
    const A5 = {}, nonA5 = {};
    P.forEach(p => {
      const e = p.inst[stem];
      if(!e || e.method !== 'Ratification') return;
      const y = String(e.date.getUTCFullYear());
      if(p.a5 === 'NON-A5') nonA5[y] = (nonA5[y]||0)+1; else A5[y] = (A5[y]||0)+1;
    });
    const tot = Object.values(A5).reduce((a,b)=>a+b,0) + Object.values(nonA5).reduce((a,b)=>a+b,0);
    ratif[INST_SHORT[stem]] = { A5, nonA5, total: tot };
  });

  /* --- Figure 3: first 30 parties to act on Kigali (any method) --- */
  const kig = P.filter(p => p.inst.Kigali)
               .sort((a,b) => a.inst.Kigali.date - b.inst.Kigali.date);
  const first30 = kig.slice(0,30).map((p,i) => ({
    rank:i+1, date: iso(p.inst.Kigali.date), country:p.country, a5:p.a5
  }));

  /* --- Figure 4: world map, coloured by year joined (EU has no polygon) --- */
  const kigali_map = kig
    .filter(p => p.iso3)
    .map(p => ({ iso:p.iso3, name:p.country,
                 year:p.inst.Kigali.date.getUTCFullYear(),
                 date: ddMonY(p.inst.Kigali.date) }));

  /* --- Figure 5: first 10 parties to RATIFY (strict) --- */
  const top10 = {};
  STEMS.forEach(stem => {
    top10[INST_LONG[stem]] = P
      .filter(p => p.inst[stem] && p.inst[stem].method === 'Ratification')
      .sort((a,b) => a.inst[stem].date - b.inst[stem].date)
      .slice(0,10)
      .map(p => ({ country:p.country, iso2:p.iso2,
                   date: dMonY(p.inst[stem].date), method:'Ratification' }));
  });

  /* --- hero KPIs --- */
  const nParties = stem => P.filter(p => p.inst[stem]).length;
  const nRatif   = stem => P.filter(p => p.inst[stem] && p.inst[stem].method==='Ratification').length;
  const kigYears = {};
  P.forEach(p => { if(p.inst.Kigali){ const y=p.inst.Kigali.date.getUTCFullYear();
                   kigYears[y]=(kigYears[y]||0)+1; } });
  const peak = Object.values(kigYears).length ? Math.max(...Object.values(kigYears)) : 0;
  const first5A5 = kig.slice(0,5).filter(p => p.a5==='A5').length;
  const allSeven = P.filter(p => STEMS.every(s => p.inst[s])).length;

  const summary = {
    totalPartiesMP: nParties('MP'),
    instruments: STEMS.length,
    kigaliAgreements: nParties('Kigali'),
    kigaliCountriesMapped: kigali_map.length,
    yearsCovered: years.length,
    ratificationShareKigali: +(100*nRatif('Kigali')/Math.max(1,nParties('Kigali'))).toFixed(1),
    ratificationShareMP:     +(100*nRatif('MP')/Math.max(1,nParties('MP'))).toFixed(1),
    allSixInstruments: allSeven,
    firstFiveKigaliA5: first5A5 + '/5',
    longestActionGap: 9,
    kigaliRatifications: nRatif('Kigali'),
    kigaliPeakYearAgreements: peak,
  };

  return { cumulative, milestones: readMilestones(wb), ratif, first30,
           kigali_map, top10, summary, analysisCards:[], closingCards:[] };
}

/* ---------- loader ---------- */
async function loadMasterWorkbook(){
  const res = await fetch(MASTER_FILE, {cache:'no-cache'});
  if(!res.ok) throw new Error(`${MASTER_FILE} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return XLSX.read(buf, {type:'array', cellDates:true});
}
