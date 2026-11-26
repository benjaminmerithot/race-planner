// Pulls half and full marathons for the next 12 months from RunSignup's public
// races API, one state or province at a time, and writes data/runsignup.json.
//
// RunSignup's API Developer Contract applies: no more than 2 concurrent calls
// (we make one at a time), a reasonable call rate, no bulk copy of their data.
// The snapshot is therefore gitignored and only kept in the CI cache; the page
// ships just the fields it shows.
//
// From 2027-01-01 every call needs an API caller registration:
//   RSU_API_REG          token, sent as the rsu_api_reg query parameter
//   RSU_API_REG_SECRET   secret, sent as the X-RSU-API-REG-SECRET header
import fs from 'fs';

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const PROVINCES = 'AB BC MB NB NL NS NT ON PE QC SK YT'.split(' ');
const OUT = 'data/runsignup.json';
const PAUSE_MS = 1500;
const RUN_TYPES = new Set(['running_race', 'running_only', 'trail_race']);

const iso = d => d.toISOString().slice(0, 10);
const TODAY = process.env.BUILD_DATE || iso(new Date());
const END = iso(new Date(Date.parse(TODAY + 'T12:00:00Z') + 365 * 864e5));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "13.1 Miles", "21.1K", "26.2 Miles", "5K", "50m" -> miles (null if unknown)
function miles(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^([\d.]+)\s*(miles?|mi|k|km|m|meters?)?$/i);
  if (!m) return null;
  const n = +m[1], u = (m[2] || 'mi').toLowerCase();
  if (u.startsWith('mi')) return n;
  if (u === 'k' || u === 'km') return n * 0.621371;
  return n / 1609.34; // meters
}
function distKey(mi) {
  if (mi == null) return null;
  if (mi >= 26.1 && mi <= 26.4) return 'full';
  if (mi >= 13.0 && mi <= 13.3) return 'half';
  if (mi >= 6.1 && mi <= 6.3) return '10k';
  if (mi >= 3.0 && mi <= 3.2) return '5k';
  return null;
}
// RunSignup dates are M/D/YYYY [HH:MM]
const ymd = s => { if (!s) return null; const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` + (m[4] ? 'T' + m[4] : '') : null; };
const money = s => s == null ? null : +String(s).replace(/[^0-9.]/g, '') || null;

async function get(params) {
  const u = new URL('https://runsignup.com/Rest/races');
  const q = { format: 'json', results_per_page: 1000, events: 'T', race_headings: 'F', race_links: 'F', include_waiver: 'F', start_date: TODAY, end_date: END, distance_units: 'M', min_distance: 13, max_distance: 26.4, ...params };
  if (process.env.RSU_API_REG) q.rsu_api_reg = process.env.RSU_API_REG;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const headers = { 'User-Agent': 'race-planner-build (personal calendar)' };
  if (process.env.RSU_API_REG_SECRET) headers['X-RSU-API-REG-SECRET'] = process.env.RSU_API_REG_SECRET;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(u, { headers });
    if (res.ok) { const j = await res.json(); if (j.error) throw new Error(JSON.stringify(j.error)); return j.races || []; }
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`RunSignup ${res.status} for ${params.state || ''}: ${(await res.text()).slice(0, 200)}`);
    await sleep(PAUSE_MS * 4 * attempt);
  }
}

function normalize({ race }, region, country) {
  if (race.is_draft_race === 'T' || race.is_private_race === 'T') return null;
  const evs = [];
  for (const e of race.events || []) {
    if (!RUN_TYPES.has(e.event_type)) continue;
    const d = distKey(miles(e.distance));
    if (!d) continue;
    const periods = (e.registration_periods || []).map(p => ({ opens: ymd(p.registration_opens), closes: ymd(p.registration_closes), fee: money(p.race_fee) }));
    evs.push({ d, start: ymd(e.start_time), opens: ymd(e.registration_opens), closes: ymd(e.registration_closes), periods });
  }
  if (!evs.some(e => e.d === 'half' || e.d === 'full')) return null;
  // the race's date is its longest headline event's date
  const main = evs.find(e => e.d === 'full') || evs.find(e => e.d === 'half');
  const date = (main.start || ymd(race.next_date) || '').slice(0, 10);
  if (!date || date < TODAY || date > END) return null;
  const a = race.address || {};
  return {
    rsid: race.race_id, name: race.name.trim(), city: (a.city || '').trim(), region: (a.state || region).toUpperCase(), country,
    zip: a.zipcode || '', date, dists: [...new Set(evs.map(e => e.d))],
    url: race.url, site: race.external_race_url || '', open: race.is_registration_open === 'T',
    modified: race.last_modified || '', events: evs
  };
}

const all = new Map();
const counts = {};
const regions = [...STATES.map(s => [s, 'US']), ...PROVINCES.map(s => [s, 'CA'])];
for (const [st, country] of regions) {
  let races;
  try { races = await get({ state: st, country_code: country }); }
  catch (e) { console.error('skip', st, e.message); counts[st] = 'error'; continue; }
  let n = 0;
  for (const r of races) {
    const x = normalize(r, st, country);
    // the state filter is on the race address; drop anything that leaked across
    if (!x || x.region !== st) continue;
    all.set(x.rsid, x); n++;
  }
  counts[st] = n;
  if (races.length >= 1000) console.warn(st, 'hit the 1000-per-page limit; add paging');
  await sleep(PAUSE_MS);
}
const list = [...all.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ fetched: new Date().toISOString(), from: TODAY, to: END, races: list }));
console.log('runsignup', list.length, 'races', JSON.stringify(counts));
