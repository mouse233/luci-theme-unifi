// SPDX-License-Identifier: Apache-2.0
import { readfile, unlink, popen } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';
import { init, timer, process, run } from 'uloop';
import { create_presence_state } from './presence-state.uc';

init();
const bus = connect(), config = cursor(), states = create_presence_state();
const enabled = config.get('unifi', 'theme', 'presence_enabled') != '0';
if (!bus) die('Unable to connect presence collector to ubus\n');
let devices = {}, bindings = {}, trusted = {}, previous = {}, active = null, last_inventory = -30, last_passive = -10;
function monotime() { return +(split(readfile('/proc/uptime') ?? '0', ' ')[0]); }
function mac(v) {
	v = uc(v ?? '');
	return match(v, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/) && v != '00:00:00:00:00:00' ? v : null;
}
function ipv4(v) {
	let p = split(v ?? '', '.');
	if (length(p) != 4) return null;
	let n = 0;
	for (let x in p) { if (!match(x, /^\d{1,3}$/) || +x > 255) return null; n = n * 256 + +x; }
	return n;
}
function inventory() {
	let networks = (bus.call('network.interface', 'dump', {}) ?? {}).interface ?? [];
	let lan = null;
	for (let n in networks) if (n.interface == 'lan' && n.up && n.l3_device && length(n['ipv4-address'] ?? []) == 1) lan = n;
	if (!lan) { devices = {}; bindings = {}; return; }
	let a = lan['ipv4-address'][0], base = ipv4(a.address), bits = +a.mask;
	if (base == null || bits < 8 || bits > 30 || !match(lan.l3_device, /^[a-zA-Z0-9_.-]+$/)) { devices = {}; bindings = {}; return; }
	let block = 2 ** (32 - bits), map = {}, byip = {};
	function add(m, ip) {
		m = mac(m); let n = ipv4(ip);
		if (!m || n == null || n == base || int(n / block) != int(base / block) || n % block == 0 || n % block == block - 1) return;
		if (map[m] && map[m].ip != ip) { map[m].conflict = true; return; }
		if (byip[ip] && byip[ip] != m) { map[byip[ip]].conflict = true; map[m] = { conflict: true, ip: ip }; return; }
		byip[ip] = m; map[m] = map[m] ?? { ip: ip, device: lan.l3_device };
	}
	let leases = (bus.call('luci-rpc', 'getDHCPLeases', {}) ?? {}).dhcp_leases ?? [];
	for (let l in leases) add(l.macaddr, l.ipaddr);
	for (let k, v in config.get_all('dhcp') ?? {}) if (v['.type'] == 'host') {
		let list = type(v.mac) == 'array' ? v.mac : split(v.mac ?? '', /\s+/);
		for (let m in list) add(m, v.ip);
	}
	let arp = {};
	for (let line in split(readfile('/proc/net/arp') ?? '', '\n')) {
		let p = split(trim(line), /\s+/);
		if (length(p) >= 6 && p[5] == lan.l3_device && p[2] == '0x2' && mac(p[3])) { add(p[3], p[0]); arp[p[0]] = mac(p[3]); }
	}
	for (let m, d in map) {
		let old = devices[m];
		if (old && (old.ip != d.ip || old.device != d.device || d.conflict != old.conflict)) { states.reset(m); delete trusted[m]; }
	}
	for (let m in devices) if (!map[m]) { states.reset(m); delete trusted[m]; }
	devices = map; bindings = arp;
	// REACHABLE is a kernel confirmation, unlike a merely retained STALE entry.
	let f = popen('/usr/bin/ip -4 neigh show 2>/dev/null', 'r');
	let neighbours = f ? f.read('all') : '';
	if (f) f.close();
	for (let line in split(neighbours ?? '', '\n')) {
		let m = match(line, /^(\d+\.\d+\.\d+\.\d+) dev ([^ ]+) lladdr ([0-9a-fA-F:]+) REACHABLE/);
		if (!m) continue;
		let id = mac(m[3]), d = devices[id];
		if (d && !d.conflict && d.ip == m[1] && d.device == m[2]) {
			trusted[id] = monotime() + 60;
			states.evidence(id, monotime(), time());
		}
	}
}
function passive(now) {
	let current = {}, data = readfile('/proc/net/nf_conntrack');
	if (data == null) { previous = {}; return; }
	for (let line in split(data, '\n')) {
		let parts = split(line, ' src=');
		if (length(parts) < 2) continue;
		let m = match(parts[1], /^(\d+\.\d+\.\d+\.\d+) ([^\n]*) packets=(\d+) bytes=/);
		if (!m) continue;
		let key = m[1] + ' ' + m[2], count = +m[3], id = bindings[m[1]], d = devices[id];
		current[key] = count;
		if (previous[key] != null && count > previous[key] && d && !d.conflict && d.ip == m[1] && (trusted[id] ?? 0) >= now) states.evidence(id, now, time());
	}
	previous = current;
}
function probe(id, now) {
	let d = devices[id], generation = states.get(id).generation, path = '/var/run/unifi-presence/arp';
	active = process('/bin/sh', ['-c', 'out="$1"; shift; exec /usr/bin/arping "$@" > "$out" 2>&1', 'unifi-presence', path, '-b', '-f', '-c', '1', '-w', '2', '-I', d.device, d.ip], null, function(code) {
		let text = readfile(path) ?? ''; unlink(path); active = null;
		let live = devices[id]; if (!live || live.ip != d.ip || live.device != d.device || live.conflict) return;
		let reply = match(text, /reply from ([0-9.]+) \[([0-9A-Fa-f:]+)\]/);
		if (code == 0 && reply && reply[1] == d.ip && mac(reply[2]) == id) { trusted[id] = monotime() + 120; states.evidence(id, monotime(), time()); }
		else if (reply && mac(reply[2]) != id) { live.conflict = true; delete trusted[id]; states.reset(id); }
		else if (code == 1 && match(text, /Sent 1 probes/) && match(text, /Received 0 response/)) states.failure(id, monotime(), generation, true);
	});
}
let object = bus.publish('unifi.presence', { list: { args: { ubus_rpc_session: '' }, call: function(req) {
	let result = {}; for (let id, d in devices) if (!d.conflict) result[id] = states.get(id);
	req.reply({ devices: result });
} } });
if (!object) die('Unable to publish presence status\n');
let tick; tick = timer(-1, function() {
	let now = monotime();
	if (now - last_inventory >= 30) { inventory(); last_inventory = now; }
	if (now - last_passive >= 10) { passive(now); last_passive = now; }
	if (!active) for (let id, d in devices) if (!d.conflict && now >= states.get(id).next_probe) { probe(id, now); break; }
	tick.set(1000);
});
if (enabled) tick.set(1000);
run();
