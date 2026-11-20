const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/unifi/core.js'), 'utf8');
const core = new Function('baseclass', source)({extend:o=>o});
test('every shipped JavaScript module parses through the LuCI-style loader', () => {
  for (const name of ['menu-unifi.js','unifi/core.js','unifi/icons.js','unifi/data.js','unifi/brands.js','unifi/vendor-data.js','unifi/brand-map.js','unifi/icon-data.js','unifi/theme.js','unifi/menu-fallback.js','unifi/overview.js','unifi/client-model.js','unifi/clients.js','view/unifi/dashboard.js','view/unifi/clients.js','unifi/settings.js','view/unifi/settings.js'])
    assert.doesNotThrow(()=>new Function(fs.readFileSync(path.join(root,'htdocs/luci-static/resources',name),'utf8')));
  assert.doesNotThrow(()=>new Function(fs.readFileSync(path.join(root,'preview/app.js'),'utf8')));
  assert.doesNotThrow(()=>new Function(fs.readFileSync(path.join(root,'preview/client-fixtures.js'),'utf8')));
  assert.doesNotThrow(()=>new Function(fs.readFileSync(path.join(root,'preview/control-fixtures.js'),'utf8')));
});
test('throughput uses elapsed time and converts bytes to decimal bits', () => {
  const a={device:'eth0',rx:100,tx:50,time:1000,uptime:100};
  const b={device:'eth0',rx:5000100,tx:1250050,time:6000,uptime:105};
  assert.deepEqual(core.delta(a,b),{down:1000000,up:250000});
  assert.equal(core.rate(1000000),'8.00 Mbps');
  assert.equal(core.rate(null),'—');
  assert.equal(core.bytes(1024),'1.0 KiB');
});
test('counter resets, reboot, device changes and long gaps never create false spikes', () => {
  const a={device:'eth0',rx:100,tx:100,time:1000,uptime:100};
  const b={...a,rx:300,tx:300,time:6000,uptime:105};
  assert.equal(core.delta(null,b),null);
  assert.equal(core.delta(a,{...b,rx:1}),null);
  assert.equal(core.delta(a,{...b,device:'eth1'}),null);
  assert.equal(core.delta(a,{...b,uptime:2}),null);
  assert.equal(core.delta(a,{...b,time:40000}),null);
  assert.equal(core.delta(a,{...b,time:1000}),null);
});
test('CPU excludes double-counted guest times and includes idle+iowait', () => {
  const a=core.cpu('cpu  100 20 30 700 40 10 0 0 50 10\ncpu0 1 2 3 4\n');
  assert.deepEqual(a,{total:900,idle:740});
  const b={total:1000,idle:820};
  assert.ok(Math.abs(core.cpuUsage(a,b)-20)<1e-8);
  assert.equal(core.cpuUsage(null,b),null);
  assert.equal(core.cpuUsage(b,a),null);
  assert.equal(core.cpu('garbage'),null);
});
test('missing resources remain unavailable, valid percentages are bounded', () => {
  assert.equal(core.percent(null,100),null);
  assert.equal(core.percent(10,0),null);
  assert.equal(core.percent(110,100),100);
  assert.equal(core.percent(-10,100),0);
});
test('chart gaps split paths instead of implying unobserved traffic', () => {
  const paths=core.series([{time:0,down:5},{time:5,down:null},{time:10,down:10}], 'down',100,100,10,0,10);
  assert.deepEqual(paths,['M0.00,50.00','M100.00,0.00']);
  assert.deepEqual(core.series([{time:0,down:NaN}], 'down',100,100,10,0,10),[]);
});

test('scrolling paths retain measured boundary segments for clipping without bridging missing samples', () => {
  const points=[{time:-1,down:2},{time:1,down:4},{time:2,down:null},{time:3,down:8},{time:5,down:9}];
  const paths=core.series(points,'down',100,100,10,0,4,1);
  assert.deepEqual(paths,['M-25.00,80.00 L25.00,60.00','M75.00,20.00 L125.00,10.00']);
});
test('production module does not contain synthetic history or router mutation APIs', () => {
  const prod=fs.readFileSync(path.join(root,'htdocs/luci-static/resources/unifi/overview.js'),'utf8');
  assert.equal(/innerHTML|Math\.random|fixture|uci\.set|uci\.save|fs\.exec|fs\.write/.test(prod),false);
});

test('background history restores, appends without duplicates and handles router clock skew', () => {
  const result = {id:'a', cursor:2, now:102000, samples:[[1,101000,null,null],[2,102000,1000,500]]};
  const first = core.activityHistory([], null, result, 202000);
  assert.equal(first.history.length, 2);
  assert.deepEqual(first.history[1], {time:202000,down:1000,up:500});
  const next = core.activityHistory(first.history, first.state, {...result,cursor:3,now:103000,samples:[[2,102000,1000,500],[3,103000,2000,750]]}, 203000);
  assert.equal(next.history.length, 3);
  assert.deepEqual(next.history[2], {time:203000,down:2000,up:750});
});

test('collector restart replaces history and a disconnected interface produces a chart gap', () => {
  const before = core.activityHistory([], null, {id:'a',cursor:10,now:10000,samples:[[10,10000,5,2]]}, 10000);
  const after = core.activityHistory(before.history, before.state, {id:'a',cursor:15,now:15000,samples:[[15,15000,null,null]]}, 15000);
  assert.equal(after.history[1].down, null);
  const restart = core.activityHistory(after.history, after.state, {id:'b',cursor:1,now:16000,samples:[[1,16000,null,null]]}, 16000);
  assert.equal(restart.history.length, 1);
  assert.equal(restart.state.id, 'b');
});
