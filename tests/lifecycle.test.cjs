const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '../htdocs/luci-static/resources');
const bind = (fn, scope) => fn.bind(scope);
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const source = name => fs.readFileSync(path.join(base, 'unifi', name + '.js'), 'utf8');

function dashboardFixture(collect = () => Promise.resolve({info: {uptime: 1}})) {
  const active = new Set(), intervals = [];
  const frames = new Map(), listeners = new Map(); let frameID = 0;
  const media = {matches:false,addEventListener() {},removeEventListener() {}};
  const document = {documentElement:{lang:'en'},hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const window = {matchMedia:()=>media,requestAnimationFrame:fn=>{frames.set(++frameID,fn);return frameID;},cancelAnimationFrame:id=>frames.delete(id)};
  const dashboard = new Function('baseclass', 'data', 'model', 'poll', 'core', 'document', 'L', 'settings', 'window', source('overview'))(
    {extend: x => x}, {overview: collect}, {}, {add: (fn, interval) => {active.add(fn); intervals.push(interval);}, remove: fn => active.delete(fn)}, {},
    document, {bind}, {get: () => '1'}, window);
  const host = {children: [], appendChild(root) {this.children.push(root); root.remove = () => {this.children = this.children.filter(n => n !== root);};}};
  dashboard.layout = () => ({remove() {}});
  dashboard.update = () => {};
  dashboard.refreshActivity = () => Promise.resolve();
  dashboard.drawChart = () => {};
  dashboard.renderChartFrame = () => {};
  return {dashboard, host, active, intervals, frames, listeners, document, media};
}

test('mount and remount own exactly one poller and unmount removes it', async () => {
  const {dashboard, host, active, intervals, frames, listeners} = dashboardFixture();
  assert.equal(await dashboard.mount(host), true);
  await dashboard.mount(host);
  assert.equal(host.children.length, 1);
  assert.equal(active.size, 1);
  assert.deepEqual(intervals, [1, 1]);
  assert.equal(frames.size, 1);
  dashboard.unmount(); dashboard.unmount();
  assert.equal(active.size, 0); assert.equal(host.children.length, 0);
  assert.equal(frames.size, 0); assert.equal(listeners.size, 0);
});

test('hidden pages stop chart frames, visible pages resume once and late frames cannot revive an unmounted chart', async () => {
  const {dashboard,host,frames,listeners,document}=dashboardFixture();
  await dashboard.mount(host);
  const late=[...frames.values()][0];
  document.hidden=true;listeners.get('visibilitychange')();
  assert.equal(frames.size,0);
  document.hidden=false;listeners.get('visibilitychange')();
  dashboard.startChartAnimation();
  assert.equal(frames.size,1);
  dashboard.unmount();late();
  assert.equal(frames.size,0);
});

test('reduced motion retains sampling without scheduling chart animation', async () => {
  const {dashboard,host,frames,active,media}=dashboardFixture();
  media.matches=true;
  await dashboard.mount(host);
  assert.equal(frames.size,0);assert.equal(active.size,1);
  dashboard.unmount();
});

test('unmount during initial collection prevents late DOM and poll registration', async () => {
  const pending = deferred(), {dashboard, host, active} = dashboardFixture(() => pending.promise);
  const mounting = dashboard.mount(host);
  dashboard.unmount(); pending.resolve({info: {}});
  assert.equal(await mounting, false);
  assert.equal(host.children.length, 0); assert.equal(active.size, 0);
});

test('initial render failure rolls back the renderer', async () => {
  const {dashboard, host, active} = dashboardFixture();
  dashboard.update = () => {throw new Error('render failed');};
  await assert.rejects(dashboard.mount(host), /render failed/);
  assert.equal(host.children.length, 0); assert.equal(active.size, 0); assert.equal(dashboard.disposed, true);
});

test('a late poll result cannot update an unmounted or newly mounted dashboard', async () => {
  const {dashboard, host} = dashboardFixture();
  await dashboard.mount(host);
  const pending = deferred(); dashboard.collect = () => pending.promise;
  dashboard.lastOverview = 0;
  let updates = 0; dashboard.update = () => {updates++;};
  const tick = dashboard.tick(); dashboard.unmount();
  dashboard.collect = () => Promise.resolve({info: {}});
  await dashboard.mount(host);
  pending.resolve({info: {}}); await tick;
  assert.equal(updates, 1);
  assert.equal(dashboard.busy, false);
});

function viewFixture(options = {}) {
  const classes = new Set(), listeners = new Map();
  const {dashboard, host, active} = dashboardFixture(options.collect);
  host.replaceChildren = function() {this.children = [];};
  const theme = options.theme === undefined ? true : options.theme, redirects = [];
  const document = {body: {classList: {add: name => classes.add(name), remove: name => classes.delete(name), contains: name => (theme && name === 'uf-theme') || classes.has(name)}}};
  const window = {addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), location: {replace: url => redirects.push(url)}};
  const source = fs.readFileSync(path.join(base, 'view/unifi/dashboard.js'), 'utf8');
  const view = new Function('view', 'dashboard', 'L', 'window', 'document', 'E', '_', source)(
    {extend: x => x}, dashboard, {bind, url: (...parts) => '/cgi-bin/luci/' + parts.join('/')}, window, document,
    options.E || (() => host), s => s);
  return {view, dashboard, host, active, classes, listeners, redirects};
}

test('standalone dashboard renders in its own host and cleans up on destroy', async () => {
  const f = viewFixture();
  assert.equal(await f.view.render(), f.host);
  assert.equal(f.host.children.length, 1);
  assert.equal(f.classes.has('uf-dashboard-page'), true);
  assert.equal(f.active.size, 1);
  f.view.destroy();
  assert.equal(f.classes.size, 0); assert.equal(f.active.size, 0); assert.equal(f.listeners.size, 0);
});

test('standalone dashboard startup failure leaves no poller or page styles', async () => {
  const f = viewFixture({collect: () => Promise.reject(new Error('metrics unavailable'))});
  await assert.rejects(f.view.render(), /metrics unavailable/);
  assert.equal(f.classes.size, 0); assert.equal(f.host.children.length, 0); assert.equal(f.active.size, 0);
});

test('pagehide cancels pending render; persisted pageshow remounts exactly one poller', async () => {
  const pending = deferred(), f = viewFixture({collect: () => pending.promise});
  const ready = f.view.render();
  f.listeners.get('pagehide')(); pending.resolve({info: {}}); await ready;
  assert.equal(f.active.size, 0); assert.equal(f.classes.size, 0);
  f.listeners.get('pageshow')({persisted: true}); await f.view.ready;
  assert.equal(f.active.size, 1); assert.equal(f.host.children.length, 1);
  await f.view.activate(); await f.view.activate();
  assert.equal(f.active.size, 1); assert.equal(f.host.children.length, 1);
  f.view.destroy();
});

test('other themes keep LuCI overview as the start page instead of an unstyled dashboard', async () => {
  const f = viewFixture({theme: false, E: (tag, attrs, children) => ({tag, attrs, children})});
  const placeholder = await f.view.render();
  assert.deepEqual(f.redirects, ['/cgi-bin/luci/admin/status/overview']);
  assert.equal(placeholder.tag, 'p');
  assert.equal(f.active.size, 0); assert.equal(f.classes.size, 0); assert.equal(f.listeners.size, 0);
});

test('theme startup on native pages loads navigation only, even when menu loading fails', async () => {
  for (const fail of [false, true]) {
    const requested = [], classes = new Set();
    const theme = new Function('baseclass', 'L', 'document', 'console', source('theme'))(
      {extend: x => x}, {require: name => {requested.push(name);return fail ? Promise.reject(new Error('menu failed')) : Promise.resolve({});}},
      {body: {classList: {add: name => classes.add(name)}}}, {warn() {}});
    theme.__init__(); await theme.ready;
    assert.deepEqual(requested, fail ? ['menu-unifi', 'unifi.menu-fallback'] : ['menu-unifi']);
    assert.equal(classes.has('uf-menu-failed'), fail);
  }
});
