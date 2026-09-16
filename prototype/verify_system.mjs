// Exercise the dashboard's REAL renderSystem() against the exact DiagnosticArray
// shape system_diagnostics.py publishes.
import fs from 'fs';
const src = fs.readFileSync('dashboard_backup.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const panel = src.slice(src.indexOf('// ---- system diagnostics panel ----'),
                        src.indexOf('// ---- connection health ----'));
const actions = src.slice(src.indexOf('// ---- on-demand checks ----'),
                          src.indexOf('// ---- boot ----'));
const health = src.slice(src.indexOf('// ---- connection health ----'),
                         src.indexOf('// ---- on-demand checks ----'));
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
  'system: Gamepad': D(0,'connected',{'js devices':'js0',bluetooth:'connected','battery %':'not exposed by this driver'}),
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
const heads = [...tiles.matchAll(/class="v( sm)?" style="[^"]*">([^<]*)</g)]
  .map(m => ({small: !!m[1], text: m[2]}));
heads.length === want.length || fail.push('expected '+want.length+' headlines, got '+heads.length);
heads.forEach(h => h.text.length <= 14 || fail.push('headline too long for the tile: '+JSON.stringify(h.text)));
// A headline that stays at 1.7rem past ~8 characters overflows the narrowest
// tile and breaks mid-word. `connected` did exactly that on the car.
heads.forEach(h => h.text.length <= 8 || h.small
  || fail.push('headline needs the smaller size to fit its tile: '+JSON.stringify(h.text)));
heads.forEach(({text: h}) => / /.test(h.trim()) && h.split(' ').length > 2
  && fail.push('headline reads as a sentence: '+JSON.stringify(h)));
tiles.includes('>connected<') || fail.push('gamepad headline missing');
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

// ---------------------------------------------------------------------------
// The on-demand joystick check. This is the page's only control that makes the
// robot DO something, so all three of its outcomes are worth pinning: a verdict,
// a refused call, and the specific "service isn't there" case that means
// system_diagnostics.py is not running rather than the joystick being broken.
// ---------------------------------------------------------------------------
let callImpl = async () => ({});
const act = new Function('$', 'getCall', `
  const call = (...a) => getCall()(...a);
  ${actions}
  return { runJoyCheck };
`)($, () => callImpl);

const joyCase = async (impl) => {
  callImpl = impl;
  els.joyResult = undefined; delete els.joyResult;
  els.joyBtn = undefined; delete els.joyBtn;
  await act.runJoyCheck();
  return { out: $('joyResult'), btn: $('joyBtn') };
};

let r = await joyCase(async () => ({ success: true, message: 'joy_enumerate_devices: 1 device(s)' }));
r.out.textContent.includes('1 device(s)') || fail.push('joy: verdict message not shown');
r.out.style.color === 'var(--ok)' || fail.push('joy: a passing check should read OK, got ' + r.out.style.color);
r.out.className === 'on' || fail.push('joy: result pane should be revealed');
r.btn.disabled === false || fail.push('joy: button must be re-enabled after a successful run');

r = await joyCase(async () => ({ success: false, message: 'CONTRADICTION: the pad is paired' }));
r.out.style.color === 'var(--warn)' || fail.push('joy: a failed verdict is a WARN, not an error');
r.out.textContent.includes('CONTRADICTION') || fail.push('joy: the contradiction text must survive');

// A rejected call is a different thing from a check that ran and said no. This
// is the path that used to render as a blank result, because rosbridge answers a
// failed call with result:false and the old handler resolved it as a reply.
r = await joyCase(async () => { throw new Error("service /system_diagnostics/joystick_check does not exist"); });
r.out.style.color === 'var(--err)' || fail.push('joy: a refused call should read as an error');
r.out.textContent.includes('start_diagnostics.sh')
  || fail.push('joy: a missing service should point at start_diagnostics.sh, not blame the joystick');
r.btn.disabled === false || fail.push('joy: button must be re-enabled after a failed run');

r = await joyCase(async () => { throw new Error('timeout ' + 'x'); });
r.out.textContent.includes('check failed')
  || fail.push('joy: a non-missing failure should report plainly');
r.out.textContent.includes('start_diagnostics.sh')
  && fail.push('joy: a timeout is not a missing service');

// ---------------------------------------------------------------------------
// Connection health. The starved-client case is the one that matters: rosbridge
// answers service calls normally while sending no topic data, so the page looks
// like a dead robot. lastAnything alone cannot see it, because service responses
// refresh it.
// ---------------------------------------------------------------------------
const { bannerState, clientsLabel } = new Function(
  `${health}; return { bannerState, clientsLabel };`)();

// A page is itself a client, so any count below 1 is a stale value this tab never
// saw updated. Observed on the car: one tab read 2 while another read 0.
clientsLabel(null, 10).text === 'clients -' || fail.push('unknown count should render as -');
clientsLabel(0, 10).text === 'clients -' || fail.push('a count of 0 is impossible for a connected page and must read as unknown');
clientsLabel(3, 10).text === 'clients 3 / 10' || fail.push('a known count should render plainly');
clientsLabel(3, 10).cls === '' || fail.push('3 of 10 is not worth colouring');
clientsLabel(8, 10).cls === 'near' || fail.push('approaching the limit should warn');
clientsLabel(14, 10).cls === 'over' || fail.push('past the limit should be red');
const ST = o => Object.assign({
  wsOpen: true, lastAnything: 1000, lastPublish: 1000, connectedAt: 0,
  clients: null, limit: 10, connStaleMs: 4000, publishStaleMs: 8000}, o);

(bannerState(1100, ST({})) === null) || fail.push('healthy connection should show no banner');
(bannerState(1100, ST({wsOpen:false})) === null) || fail.push('a closed socket is the dot\'s job, not a banner');

let b = bannerState(9000, ST({lastAnything:1000, lastPublish:1000}));
(b && b.kind === 'stale') || fail.push('nothing at all from rosbridge should raise the stale banner');

// Services answering, no topic data: lastAnything is fresh, lastPublish is not.
b = bannerState(20000, ST({lastAnything:19900, lastPublish:1000}));
(b && b.kind === 'starved') || fail.push('no topic data while services answer should read as starved, got: '+JSON.stringify(b));
(b && /client limit \(10\)/.test(b.text)) || fail.push('the starved banner should name the limit');

// A client that has NEVER received a publish must still be caught - that is
// exactly what being client 11 looks like.
b = bannerState(20000, ST({lastAnything:19900, lastPublish:0, connectedAt:1000}));
(b && b.kind === 'starved') || fail.push('a client that never received any publish should read as starved');
b = bannerState(3000, ST({lastAnything:2900, lastPublish:0, connectedAt:1000}));
(b === null) || fail.push('do not cry starvation before a publish is even due, got: '+JSON.stringify(b));

// Over the limit while still being served ourselves: warn, do not claim starvation.
b = bannerState(1100, ST({clients:14}));
(b && b.kind === 'crowded') || fail.push('more clients than the limit should warn');
(b && /14 clients/.test(b.text)) || fail.push('the crowded banner should name the count');
(bannerState(1100, ST({clients:10})) === null) || fail.push('exactly at the limit is still served, no banner');

console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'all system-panel, joystick-check and connection-health checks passed');
process.exit(fail.length ? 1 : 0);
