import fs from 'fs';
import { geoConicConformal, geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const world = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json'));
const us = JSON.parse(fs.readFileSync('node_modules/us-atlas/states-10m.json'));
const W = 1000, H = 620;

const countries = feature(world, world.objects.countries);
const keep = new Set(['840', '124', '484']); // US, Canada, Mexico
const na = { type: 'FeatureCollection', features: countries.features.filter(f => keep.has(f.id)) };

const bbox = { type: 'MultiPoint', coordinates: [[-127, 25], [-64, 25], [-127, 53], [-60, 53], [-95, 56], [-95, 24], [-61, 45]] };
const proj = geoConicConformal().parallels([33, 49]).rotate([96, 0]).fitExtent([[232, 14], [W - 14, H - 14]], bbox);
const r = n => Math.round(n * 10) / 10;
const round = d => d && d.replace(/-?\d+\.\d+/g, m => String(r(+m)));
const path = geoPath(proj);
const clip = f => round(path(f));

const usOnly = countries.features.find(f => f.id === '840');
const ca = countries.features.find(f => f.id === '124');
const mx = countries.features.find(f => f.id === '484');
const states = mesh(us, us.objects.states, (a, b) => a !== b);
import { geoArea } from 'd3-geo';
const lakesRaw = JSON.parse(fs.readFileSync('node_modules/@geo-maps/earth-lakes-10km/map.geo.json'));
const polys = [];
for (const g of lakesRaw.geometries) {
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of list) {
    const inBox = p[0].some(([x, y]) => x > -130 && x < -55 && y > 24 && y < 58);
    if (!inBox) continue;
    let poly = { type: 'Polygon', coordinates: p };
    if (geoArea(poly) > 2 * Math.PI) poly = { type: 'Polygon', coordinates: p.map(r => r.slice().reverse()) };
    if (geoArea(poly) < 2e-6) continue; // drop tiny lakes
    polys.push(poly.coordinates);
  }
}
const lakes = { type: 'MultiPolygon', coordinates: polys };
console.log('lakes kept', polys.length);

// Hawaii inset
const hiFeat = feature(us, us.objects.states).features.find(f => f.properties.name === 'Hawaii');
const hiBox = { x: 14, y: 418, w: 200, h: 110 };
const hiProj = geoMercator().fitExtent([[hiBox.x + 10, hiBox.y + 10], [hiBox.x + hiBox.w - 10, hiBox.y + hiBox.h - 10]], hiFeat);
const hiPath = geoPath(hiProj);
const akFeat = feature(us, us.objects.states).features.find(f => f.properties.name === 'Alaska');
const akBox = { x: 14, y: 250, w: 200, h: 156 };
const akProj = geoConicConformal().parallels([55, 65]).rotate([152, 0])
  .fitExtent([[akBox.x + 8, akBox.y + 8], [akBox.x + akBox.w - 8, akBox.y + akBox.h - 8]], { type: 'MultiPoint', coordinates: [[-168, 54], [-130, 55], [-166, 71], [-141, 70]] })
  .clipExtent([[akBox.x, akBox.y], [akBox.x + akBox.w, akBox.y + akBox.h]]);
const akPath = geoPath(akProj);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const zipcodes = require('zipcodes');
const cities = require('all-the-cities');
const CAADM = { AB: '01', BC: '02', MB: '03', NB: '04', NL: '05', NS: '07', NT: '13', ON: '08', PE: '09', QC: '10', SK: '11', YT: '12' };
const MANUAL = JSON.parse(fs.readFileSync('manual-geo.json'));
const geocode = (city, st) => {
  const k = city + ',' + st; if (MANUAL[k]) return MANUAL[k];
  if (CAADM[st]) { const c = cities.filter(x => x.country === 'CA' && x.adminCode === CAADM[st] && x.name.toLowerCase() === city.toLowerCase()).sort((a, b) => b.population - a.population)[0]; return c ? [c.loc.coordinates[1], c.loc.coordinates[0]] : null; }
  const z = zipcodes.lookupByName(city, st); if (z && z.length) return [z[0].latitude, z[0].longitude];
  const c = cities.filter(x => x.country === 'US' && x.adminCode === st && x.name.toLowerCase() === city.toLowerCase()).sort((a, b) => b.population - a.population)[0];
  return c ? [c.loc.coordinates[1], c.loc.coordinates[0]] : null;
};
const TODAY = '2026-11-26';
const iso = d => d.toISOString().slice(0, 10);
const rollForward = s => { let d = new Date(s + 'T12:00:00Z'); let rolled = false; while (iso(d) < TODAY) { d = new Date(d.getTime() + 364 * 864e5); rolled = true; } return [iso(d), rolled]; };
const PROF = { 'Very Flat': [1, 'Flat'], 'Mostly Flat': [1, 'Mostly flat'], 'Downhill': [2, 'Net downhill'], 'Rolling Hills': [2, 'Rolling'], 'Hilly': [4, 'Hilly'], 'Very Hilly': [5, 'Very hilly'] };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const unmatched = [];
const curatedRaw = JSON.parse(fs.readFileSync('races.json'));
const curated = curatedRaw.map(a => {
  const [id, name, city, region, country, lat, lon, date, est, dists, diff, profile, note, temp, status, url] = a;
  const p = region === 'HI' ? hiProj([lon, lat]) : region === 'AK' ? akProj([lon, lat]) : proj([lon, lat]);
  return { id, name, city, region, country, lat, lon, date, est: !!est, dists: dists.split(','), diff, profile, note, temp, status, url, x: r(p[0]), y: r(p[1]) };
});

const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 864e5;
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
const GEN = new Set('marathon marathons half the and of city international run running race races festival weekend rock roll n annual presented by classic distance memorial mini'.split(' '));
const sig = (name, city) => { const cw = new Set(city.toLowerCase().split(/[^a-z]+/)); return new Set(name.toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GEN.has(w) && !cw.has(w))); };
function matchRace(list, name, city, st, date, dist) {
  const s = sig(name, city);
  const cands = list.filter(r => r.region === st && near(r.date, date)).sort((a, b) => (b.dists.includes(dist) - a.dists.includes(dist)));
  const words = n => new Set(n.toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GEN.has(w)));
  for (const r of cands) { const A = words(name), B = words(r.name); const c1 = new Set(city.toLowerCase().split(/[^a-z]+/)); const cw = new Set(r.city.toLowerCase().split(/[^a-z]+/).filter(w => c1.has(w))); if ([...A].some(w => B.has(w) && !cw.has(w))) return r; }
  for (const r of cands) { const t = sig(r.name, r.city); if (norm(r.city) === norm(city) && (s.size === 0 || t.size === 0) && r.dists.includes(dist)) return r; }
  return null;
}
const imported = [];
for (const line of fs.readFileSync('fulls.txt', 'utf8').trim().split('\n')) {
  const [name, city, st, mdy, prof, fin] = line.split('|');
  const [m, d, y] = mdy.split('/'); const [date, rolled] = rollForward(`${y}-${m}-${d}`);
  const fins = +fin || 0;
  const hit = matchRace(curated, name, city, st, date, 'full');
  if (hit) { hit.fin = fins || hit.fin; continue; }
  const g = geocode(city, st); if (!g) { unmatched.push(city + ',' + st); continue; }
  const p = PROF[prof] || [0, 'Not rated'];
  imported.push({ id: 'f-' + slug(name + '-' + st), name, city, region: st, country: CAADM[st] ? 'CA' : 'US', lat: g[0], lon: g[1], date, est: rolled, dists: ['full'], diff: p[0], profile: p[1], note: 'Course profile and size from FindMyMarathon', temp: null, status: 'Check race site', url: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + city + ' ' + (rolled ? '' : y)), fin: fins, src: 'fmm' });
}
const hl = fs.readFileSync('halves.txt', 'utf8').trim().split('\n').slice(1);
for (const line of hl) {
  const [date, name, city, st, dists, est, note] = line.split('|');
  const ds = dists.split(',');
  const hit = matchRace([...curated, ...imported], name, city, st, date, 'half');
  if (hit) { ds.forEach(x => { if (!hit.dists.includes(x)) hit.dists.push(x); }); continue; }
  const g = geocode(city, st); if (!g) { unmatched.push(city + ',' + st); continue; }
  imported.push({ id: 'h-' + slug(name + '-' + st), name, city, region: st, country: CAADM[st] ? 'CA' : 'US', lat: g[0], lon: g[1], date, est: est === '1', dists: ds, diff: 0, profile: 'Not rated', note: note || 'Listed on running.life', temp: null, status: 'Check race site', url: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + city), fin: 0, src: 'rl' });
}
console.log('imported', imported.length, 'unmatched', JSON.stringify(unmatched));
const DEMAND = JSON.parse(fs.readFileSync('demand.json'));
const races = [...curated, ...imported].map(q => { const p = q.region === 'HI' ? hiProj([q.lon, q.lat]) : q.region === 'AK' ? akProj([q.lon, q.lat]) : proj([q.lon, q.lat]); const dm = DEMAND[q.id] || {}; return { ...q, dem: dm.lvl || '', demNote: dm.note || '', wk: dm.wk || 0, x: r(p[0]), y: r(p[1]) }; }).filter(q => p0(q));
function p0(q) { return q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H; }
const reg = [
  ['bayshore', '2026-12-01', 'Registration opens', 0],
  ['monument10k', '2026-12-01', 'Price increases after today', 0],
  ['baa10k', '2027-03-17', 'Registration opens', 1],
  ['equinox', '2027-04-20', 'Registration opens', 1],
  ['pittsburgh', '2027-01-15', 'Price increase (was Jan 15 for 2026)', 1],
  ['nyc', '2027-03-03', 'Drawing day: results by email', 1],
  ['flyingpig', '2027-04-28', 'Registration closes', 0],
  ['chicago', '2026-12-08', 'Drawing results by email', 0],
  ['chicago', '2026-12-15', 'Drawing entries must be paid', 0],
  ['detroit', '2027-01-01', 'Registration opens; sold out in days in 2026', 1],
  ['nyc', '2027-02-03', 'Drawing application opens', 1],
  ['nyc', '2027-02-24', 'Drawing application closes', 1],
  ['twincities', '2027-03-02', 'Registration reopens', 0],
  ['peachtree', '2027-04-01', 'Lottery window opens (runs all April)', 1],
  ['mcm', '2027-04-05', 'Registration opens; sells out fast', 1],
  ['grandmas', '2027-09-30', '2028 registration opens', 1],
  ['boston', '2027-09-13', '2028 qualifier registration week', 1],
  ['chicago', '2027-10-07', '2028 application window opens', 1]
].map(([id, d, label, est]) => ({ id, d, label, est: !!est }));

const geo = {
  W, H,
  us: clip(usOnly), ca: clip(ca), mx: clip(mx), states: clip(states), lakes: clip(lakes),
  hi: round(hiPath(hiFeat)), hiBox, ak: round(akPath(akFeat)), akBox
};
fs.writeFileSync('data.js', 'const GEO=' + JSON.stringify(geo) + ';\nconst RACES=' + JSON.stringify(races) + ';\nconst REG=' + JSON.stringify(reg) + ';\n');
console.log('data.js', (fs.statSync('data.js').size / 1024).toFixed(0), 'KB', races.length, 'races');
const off = races.filter(x => x.x < 0 || x.x > W || x.y < 0 || x.y > H);
console.log('off-map:', off.map(x => x.id));
