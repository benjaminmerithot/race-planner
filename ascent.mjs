// Total ascent and descent per course from GPX files in courses/<race id>.gpx.
// Uses the GPX's own elevations; for tracks without them, looks up terrain
// elevation from Open-Meteo's elevation API (90 m DEM, 100 points a call).
// Writes ascent.json: { id: { up: ft, down: ft, from: 'gpx' | 'dem' } }.
// build.mjs adds it to each race as asc: [up, down].
import fs from 'fs';

const OUT = 'ascent.json';
const FT = 3.28084;
const STEP_M = 50;      // resample spacing along the course
const HYST_M = 2;       // ignore wiggles smaller than this (GPS and DEM noise)

const km = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

export function parseGpx(xml) {
  const pts = [];
  const re = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const lat = +(m[1].match(/lat="([^"]+)"/) || [])[1], lon = +(m[1].match(/lon="([^"]+)"/) || [])[1];
    const ele = m[2] && m[2].match(/<ele>([^<]+)<\/ele>/);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon, ele ? +ele[1] : null]);
  }
  return pts;
}

// evenly spaced points so dense and sparse GPX files compare fairly
function resample(pts) {
  const out = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = km(pts[i - 1], pts[i]) * 1000; if (!d) continue;
    let s = STEP_M - carry;
    while (s <= d) { const f = s / d, a = pts[i - 1], b = pts[i]; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * f : null]); s += STEP_M; }
    carry = (carry + d) % STEP_M;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function climb(eles) {
  let up = 0, down = 0, ref = eles[0];
  for (const e of eles.slice(1)) { const d = e - ref; if (d >= HYST_M) { up += d; ref = e; } else if (d <= -HYST_M) { down -= d; ref = e; } }
  return [Math.round(up * FT), Math.round(down * FT)];
}

async function demElevations(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 100) {
    const chunk = pts.slice(i, i + 100);
    const u = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(p => p[0].toFixed(5)).join(',')}&longitude=${chunk.map(p => p[1].toFixed(5)).join(',')}`;
    const res = await fetch(u, { headers: { 'User-Agent': 'race-planner-build (personal calendar)' } });
    if (!res.ok) throw new Error('Open-Meteo elevation ' + res.status);
    out.push(...(await res.json()).elevation);
    await new Promise(r => setTimeout(r, 500));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
  const files = fs.existsSync('courses') ? fs.readdirSync('courses').filter(f => f.endsWith('.gpx')) : [];
  for (const f of files) {
    const id = f.replace(/\.gpx$/, '');
    const raw = parseGpx(fs.readFileSync('courses/' + f, 'utf8'));
    if (raw.length < 2) { console.warn(id, 'no track points'); continue; }
    const pts = resample(raw);
    const hasEle = pts.filter(p => p[2] != null).length > pts.length * 0.9;
    const eles = hasEle ? pts.map(p => p[2]).filter(e => e != null) : await demElevations(pts);
    const [up, down] = climb(eles);
    const dist = pts.slice(1).reduce((s, p, i) => s + km(pts[i], p), 0) * 0.621371;
    result[id] = { up, down, from: hasEle ? 'gpx' : 'dem' };
    console.log(id, dist.toFixed(1), 'mi,', up, 'ft up,', down, 'ft down', hasEle ? '(gpx)' : '(dem)');
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
}
