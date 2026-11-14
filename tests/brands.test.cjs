const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '../htdocs/luci-static/resources/unifi');
const baseclass = {extend: x => x};
const read = name => new Function('baseclass', fs.readFileSync(path.join(base, name + '.js'), 'utf8'))(baseclass);
const vendors = read('vendor-data'), catalog = read('brand-map'), icons = read('icon-data');
const instantiate = database => new Function('baseclass', 'vendors', 'catalog', 'icons', fs.readFileSync(path.join(base, 'brands.js'), 'utf8'))(baseclass, database, catalog, icons);
const brands = instantiate(vendors);
const model = read('client-model');

test('a hostname hint can identify a private-MAC device without claiming a registry match', () => {
  const id = brands.identify('Guest iPhone', '6A:11:22:33:44:02');
  assert.equal(id.name, 'Apple'); assert.equal(id.type, 'phone');
  assert.equal(id.source, 'hostname'); assert.equal(id.localMac, true);
});

test('MAC matches preserve the original IEEE name even when a brand icon is available', () => {
  for (const [mac, name, key] of [
    ['00:1B:63:12:34:56', 'Apple, Inc.', 'apple'],
    ['BC:24:11:12:34:56', 'Proxmox Server Solutions GmbH', 'proxmox'],
    ['00:D8:61:12:34:56', 'Micro-Star INTL CO., LTD.', 'msi'],
    ['40:31:3C:12:34:56', 'XIAOMI Electronics,CO.,LTD', 'xiaomi']
  ]) {
    const id = brands.identify('', mac);
    assert.equal(id.name, name); assert.equal(id.key, key); assert.equal(id.source, 'mac');
    assert.equal(id.localMac, false);
  }
});

test('unrecognized local, multicast, incomplete and invalid addresses never claim a MAC vendor', () => {
  for (const mac of ['02:1B:63:12:34:56', '01:1B:63:12:34:56', '00:1B:63', '', '00:00:00:00:00:00', 'XX00:1B:63:12:34:56']) {
    const id = brands.identify('', mac);
    assert.equal(id.key, null, mac); assert.equal(id.name, null, mac); assert.equal(id.source, null, mac);
  }
});

test('hostname guesses cannot replace a known original registry organization or its icon', () => {
  const id = brands.identify('ThinkPad', '00:1B:63:12:34:56');
  assert.equal(id.name, 'Apple, Inc.'); assert.equal(id.source, 'mac'); assert.equal(id.key, 'apple');
  const intel = brands.identify('Zenbook', 'B0:3C:DC:12:34:56');
  assert.equal(intel.name, 'Intel Corporate'); assert.notEqual(intel.key, 'asus');
});

test('unknown hardware and generic device types do not invent manufacturers', () => {
  assert.equal(brands.identify('Office Printer', '').type, 'printer');
  assert.equal(brands.identify('Office Printer', '').name, null);
  assert.equal(brands.identify('Android Phone', '').name, null);
  assert.equal(brands.identify('<script>alert(1)</script>', '').name, null);
});

test('registry organizations remain available without a brand icon', () => {
  for (const [mac, name] of [
    ['60:BE:B4:12:34:56', 'S-Bluetech co., limited'],
    ['B0:3C:DC:12:34:56', 'Intel Corporate'],
    ['00:00:01:12:34:56', 'XEROX CORPORATION']
  ]) {
    const id = brands.identify('', mac);
    assert.equal(id.name, name); assert.equal(id.source, 'mac');
  }
  assert.equal(brands.identify('', 'B0:3C:DC:12:34:56').type, 'computer');
});

test('QEMU is recognized as a separate virtual-prefix hint', () => {
  const id = brands.identify('', '52:54:00:12:34:56');
  assert.equal(id.name, 'QEMU'); assert.equal(id.source, 'virtual'); assert.equal(id.localMac, true);
  assert.equal(brands.identify('', '52-54-00-12-34-56').name, 'QEMU');
  assert.equal(brands.identify('ThinkPad', '52:54:00:12:34:56').name, 'QEMU');
  for (const mac of ['52:54:01:12:34:56', '53:54:00:12:34:56', '52:54:00'])
    assert.equal(brands.identify('', mac).name, null);
});

test('the most specific 36/28/24-bit assignment wins and uses its full address range', () => {
  const fixture = {names: ['Parent', 'Medium', 'Small'], tables: {
    24: Buffer.from('0011220000', 'hex').toString('base64'),
    28: Buffer.from('001122300001', 'hex').toString('base64'),
    36: Buffer.from('00112233400002', 'hex').toString('base64')
  }};
  const lookup = instantiate(fixture);
  for (const tail of ['000', 'fff']) assert.equal(lookup.identify('', '001122334' + tail).name, 'Small');
  for (const mac of ['001122300000', '0011223fffff']) assert.equal(lookup.identify('', mac).name, 'Medium');
  assert.equal(lookup.identify('', '001122400000').name, 'Parent');
  assert.equal(lookup.identify('', '001123000000').name, null);
});

test('every bundled assignment returns its original name with longest-prefix precedence', () => {
  const reference = {}, cases = [];
  for (const bits of [24, 28, 36]) {
    reference[bits] = new Map();
    const records = Buffer.from(vendors.tables[bits], 'base64'), width = Math.ceil(bits / 8), stride = width + 2;
    assert.equal(records.length % stride, 0);
    let previous = -1;
    for (let offset = 0; offset < records.length; offset += stride) {
      const key = records.readUIntBE(offset, width);
      assert.ok(key > previous); previous = key;
      const prefix = key.toString(16).padStart(width * 2, '0').slice(0, bits / 4);
      const name = vendors.names[records.readUInt16BE(offset + width)];
      assert.ok(name); reference[bits].set(prefix, name);
      if (!(records[offset] & 3)) cases.push(prefix.padEnd(12, 'a'));
    }
  }
  assert.ok(cases.length > 50000);
  for (const mac of cases) {
    const expected = [36, 28, 24].map(bits => reference[bits].get(mac.slice(0, bits / 4))).find(Boolean);
    const id = brands.identify('', mac);
    assert.equal(id.name, expected, mac); assert.equal(id.source, 'mac', mac);
  }
});

test('vendor search includes raw organization names and brand hints', () => {
  const rows = [
    {id: 'b', name: 'second', ipv4: [], ipv6: [], networks: [], identity: brands.identify('ThinkPad', '')},
    {id: 'a', name: 'first', ipv4: [], ipv6: [], networks: [], identity: brands.identify('iPad', '')},
    {id: 'c', name: 'unknown', ipv4: [], ipv6: [], networks: [], identity: brands.identify('', '')},
    {id: 'd', name: 'Desktop', ipv4: [], ipv6: [], networks: [], identity: brands.identify('', '00:D8:61:12:34:56')}
  ];
  assert.deepEqual(model.query(rows, {search: 'apple'}).map(r => r.id), ['a']);
  assert.deepEqual(model.query(rows, {search: 'micro-star'}).map(r => r.id), ['d']);
  assert.deepEqual(model.query(rows, {search: 'msi'}).map(r => r.id), ['d']);
  assert.equal(model.query(rows, {sort: 'vendor'}).at(-1).id, 'c');
});

test('separate data, mapping and SVG modules share a snapshot and retain source provenance', () => {
  assert.equal(vendors.snapshot, catalog.snapshot); assert.equal(vendors.snapshot, icons.snapshot);
  for (const brand of Object.values(catalog.brands)) {
    if (!brand.name) continue;
    assert.ok(brand.letter || icons.paths[brand.icon]);
    for (const p of icons.paths[brand.icon] || []) assert.match(p, /^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\s-]+$/);
  }
  const sources = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tools/brand-data-sources.json'), 'utf8'));
  for (const url of ['https://standards-oui.ieee.org/oui/oui.csv', 'https://standards-oui.ieee.org/oui28/mam.csv',
    'https://standards-oui.ieee.org/oui36/oui36.csv', 'https://standards-oui.ieee.org/iab/iab.csv']) assert.ok(sources[url]);
  assert.equal(Object.keys(sources).some(url => /nmap/.test(url)), false);
  for (const item of Object.values(sources)) assert.match(item.sha256, /^[0-9a-f]{64}$/);
});
