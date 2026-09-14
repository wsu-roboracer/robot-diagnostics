// Exercise the dashboard's REAL renderSystem() against the exact DiagnosticArray
// shape system_diagnostics.py publishes.
import fs from 'fs';
const src = fs.readFileSync('dashboard.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const panel = src.slice(src.indexOf('// ---- system diagnostics panel ----'),
                        src.indexOf('// ---- boot ----'));
const esc = src.slice(src.indexOf('const esc'), src.indexOf('\n', src.indexOf('const esc'))+1);

const els = {};
const $ = id => els[id] || (els[id] = {textContent:'', innerHTML:'', style:{}});

const env = new Function('$','esc_src','panel_src', `
  let diag = {};
  const SYS_PREFIX = 'system: ';
  ${esc}
  ${panel}
  return { renderSystem, setDiag: d => { diag = d; },
           setOpen: v => { sysOpen = v; } };
`)($);

const D = (level, message, values) => ({level, message, values});
env.setDiag({
  'system: Thermal': D(0,'junction 51.0 C',{'cpu-thermal':'51.0 C','tj-thermal':'51.0 C','gpu-thermal':'50.0 C'}),
  'system: CPU':     D(0,'load 1.95 over 6 cores',{cores:'6','load 1m':'1.95'}),
  'system: Memory':  D(0,'63% available',{'available %':'63.0',available:'4.95 GB'}),
  'system: Storage': D(0,'4% of / used',{'used %':'4.0',free:'883 GB'}),
  'system: Power':   D(2,'REBOOTED - uptime went backwards (brownout?)',{uptime:'12 s'}),
  'system: Camera':  D(0,'USB3 at 5000 M',{'link speed':'5000 M',product:'Intel(R) RealSense(TM) Depth Camera 435i',serial:'317622075395'}),
  'system: Gamepad': D(1,'no controller connected',{'js devices':'none','battery %':'not exposed by this driver'}),
  'system: Network': D(0,'2 links up',{'lidar 192.168.0.10':'reachable, 0.187 ms'}),
  'system: Clock':   D(3,'not probed yet',{}),
  'urg_node: Hardware Status': D(0,'Streaming',{}),   // must NOT appear here
});
env.renderSystem();

const tiles = els.sysTiles.innerHTML;
const fail = [];
const want = ['Thermal','Power','CPU','Memory','Storage','Network','Camera','Gamepad','Clock'];
want.forEach(w => tiles.includes('>'+w+'<') || fail.push('missing tile: '+w));
tiles.includes('urg_node') && fail.push('urg_node leaked into the system panel');
tiles.includes('51.0 C')   || fail.push('tj-thermal headline missing');
tiles.includes('5000 M')   || fail.push('camera link speed missing');
els.sysinfo.textContent === 'ERROR' || fail.push('summary should be ERROR (brownout), got: '+els.sysinfo.textContent);
els.sysHint.style.display === 'none' || fail.push('hint should be hidden once data arrives');

// Headlines live in a 1.7rem monospace slot. A sentence there overflows the tile,
// which is exactly what shipped the first time. Nothing may be long or a sentence.
const heads = [...tiles.matchAll(/class="v(?: sm)?" style="[^"]*">([^<]*)</g)].map(m=>m[1]);
heads.length === want.length || fail.push('expected '+want.length+' headlines, got '+heads.length);
heads.forEach(h => h.length <= 14 || fail.push('headline too long for the tile: '+JSON.stringify(h)));
heads.forEach(h => / /.test(h.trim()) && h.split(' ').length > 2
  && fail.push('headline reads as a sentence: '+JSON.stringify(h)));
tiles.includes('>none<') || fail.push('gamepad headline should be the short "none"');
tiles.includes('>unknown<') || fail.push('a level-3 status should headline as "unknown"');

// A probe that raised must say so on the tile, with the detail underneath.
env.setDiag({'system: Thermal': D(2,'TypeError at line 19: can\'t concat NoneType to bytes',
  {probe:'thermal',exception:'TypeError',line:'19'})});
env.renderSystem();
els.sysTiles.innerHTML.includes('probe failed')
  || fail.push('a raised probe should headline as "probe failed"');
els.sysTiles.innerHTML.includes('TypeError at line 19')
  || fail.push('the exception detail should appear in the note');

// STALE must not be treated as the worst level
env.setDiag({'system: Clock': D(3,'not probed yet',{})});
env.renderSystem();
els.sysinfo.textContent === '1 checks OK' || fail.push('STALE alone should not read as ERROR/WARN, got: '+els.sysinfo.textContent);

// empty state
env.setDiag({});
env.renderSystem();
els.sysHint.style.display === 'block' || fail.push('hint should return when nothing is reporting');
els.sysinfo.textContent === 'not reporting' || fail.push('summary should reset');

console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'all system-panel checks passed');
process.exit(fail.length ? 1 : 0);
