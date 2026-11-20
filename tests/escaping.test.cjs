const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '../htdocs/luci-static/resources/unifi');
const read = name => fs.readFileSync(path.join(base, name), 'utf8');

// Client-supplied DHCP/DHCPv6 host names can contain markup (odhcpd keeps
// invalid names and only flags them). LuCI's E() parses a lone string child
// with innerHTML, so the fake below does the same and records it.
const PAYLOAD = '<img src=x onerror=alert(1)>';
function fakeNode(tag) {
  return {tag, attrs: {}, children: [], innerHTML: undefined,
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; }};
}
function E(tag, attrs, children) {
  const node = fakeNode(tag); node.attrs = attrs || {};
  if (Array.isArray(children)) children.forEach(child => { if (child != null) node.appendChild(typeof child === 'object' ? child : {text: String(child)}); });
  else if (children != null && typeof children === 'object') node.appendChild(children);
  else if (children != null) node.innerHTML = String(children);
  return node;
}
function walk(node, out = {html: [], text: []}) {
  if (!node || typeof node !== 'object') return out;
  if (node.innerHTML !== undefined) out.html.push(node.innerHTML);
  if (node.text !== undefined) out.text.push(node.text);
  (node.children || []).forEach(child => walk(child, out));
  return out;
}
const model = new Function('baseclass', read('client-model.js'))({extend: x => x});
const core = new Function('baseclass', read('core.js'))({extend: x => x});
const L = {bind: (fn, scope) => fn.bind(scope)};
const document = {documentElement: {lang: 'en'}};

test('dashboard lease table inserts client host names as text, never as markup', () => {
  const dashboard = new Function('baseclass', 'data', 'model', 'poll', 'core', 'icons', 'settings', 'E', 'L', 'document', read('overview.js'))(
    {extend: x => x}, {}, model, {}, core, {create: () => fakeNode('svg')}, {get: () => '1'}, E, L, document);
  dashboard.refs = {search: {value: ''}, clientCount: {}, clients: fakeNode('div')};
  dashboard.data = {leases: {dhcp_leases: [{macaddr: '02:00:00:00:00:01', ipaddr: '192.168.1.10', hostname: PAYLOAD}],
    dhcp6_leases: [{duid: '000100', hostname: PAYLOAD, ip6addrs: ['fd00::5']}]}};
  dashboard.drawClients();
  const out = walk(dashboard.refs.clients);
  assert.ok(out.html.every(html => !html.includes('<')), 'no markup reaches innerHTML');
  assert.equal(out.text.filter(text => text === PAYLOAD).length, 2);
});

test('client inventory cells insert names, vendors, SSIDs and networks as text', () => {
  const clients = new Function('baseclass', 'data', 'poll', 'core', 'model', 'brands', 'settings', 'icons', 'E', 'L', 'document', 'navigator', read('clients.js'))(
    {extend: x => x}, {}, {}, core, model, {avatar: () => fakeNode('span')}, {get: () => '50'}, {create: () => fakeNode('svg')}, E, L, document, {language: 'en'});
  const row = {id: 'x', mac: '02:00:00:00:00:01', name: PAYLOAD, status: 'unknown', associated: true, ssid: PAYLOAD, device: PAYLOAD,
    networks: [PAYLOAD], ipv4: [PAYLOAD], ipv6: [], identity: {name: PAYLOAD, type: null, source: 'mac'}};
  for (const key of ['name', 'vendor', 'connection', 'networks', 'ip']) {
    const out = walk(clients.cell(row, key));
    assert.ok(out.html.every(html => !html.includes('<')), key + ' keeps markup out of innerHTML');
    assert.ok(out.text.some(text => text.includes(PAYLOAD)), key + ' shows the original text');
  }
});
