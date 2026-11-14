/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require rpc';
'require fs';
'require network';
'require unifi.core as core';

var board = rpc.declare({ object: 'system', method: 'board' });
var info = rpc.declare({ object: 'system', method: 'info' });
var leases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases' });
var hints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints' });
var dhcp = rpc.declare({ object: 'uci', method: 'get', params: ['config'], expect: { values: {} } });
var pending = {};
var presence = rpc.declare({ object: 'unifi.presence', method: 'list' });
var activity = rpc.declare({ object: 'unifi.activity', method: 'history', params: ['device', 'since', 'id'] });
var deviceStatus = rpc.declare({ object: 'network.device', method: 'status', params: ['name'] });

// A snapshot lasts for one collection only. Concurrent consumers of the same
// profile share work; subsequent polls always read fresh counters and leases.
function collect(profile) {
	if (pending[profile]) return pending[profile];
	var result = { unavailable: [] };
	function read(key, fn, fallback) {
		return Promise.resolve().then(function() { return fn(); }).then(function(value) {
			result[key] = value;
		}).catch(function() {
			result[key] = fallback;
			result.unavailable.push(key);
		});
	}
	pending[profile] = Promise.resolve().then(function() {
		return network.flushCache();
	}).catch(function() {}).then(function() {
		var jobs = [
			read('leases', leases, null),
			read('devices', function() { return network.getDevices(); }, []),
			read('wans', function() { return network.getWANNetworks(); }, [])
		];
		if (profile === 'overview') {
			jobs.push(
				read('board', board, null),
				read('info', info, null),
				read('cpu', function() { return fs.read('/proc/stat').then(core.cpu); }, null),
				read('connections', function() { return fs.read('/proc/sys/net/netfilter/nf_conntrack_count').then(Number); }, null),
				read('maxConnections', function() { return fs.read('/proc/sys/net/netfilter/nf_conntrack_max').then(Number); }, null)
			);
		}
		else {
			jobs.push(
				read('presence', function() { return presence().then(function(r) { return r.devices || {}; }); }, {}),
				read('hints', hints, {}),
				read('arp', function() { return fs.read('/proc/net/arp'); }, ''),
				read('statics', function() {
					return dhcp('dhcp').then(function(values) {
						return Object.keys(values || {}).map(function(key) { return values[key]; })
							.filter(function(value) { return value['.type'] === 'host'; });
					});
				}, []),
				read('networks', function() { return network.getNetworks(); }, []),
				read('wifi', function() {
					return network.getWifiNetworks().then(function(nets) {
						return Promise.all(nets.filter(function(w) { return w.getMode() === 'ap'; }).map(function(w) {
							return w.getAssocList().then(function(peers) {
								return peers.map(function(peer) {
									return Object.assign({}, peer, { device: w.getIfname(), ssid: w.getSSID(), channel: w.getChannel(), networks: w.getNetworkNames() });
								});
							});
						}));
					}).then(function(lists) { return [].concat.apply([], lists); });
				}, [])
			);
		}
		return Promise.all(jobs);
	}).then(function() {
		if (profile === 'clients') {
			result.deviceNetworks = {};
			result.networks.forEach(function(n) {
				var dev = n.getL3Device();
				if (dev) result.deviceNetworks[dev.getName()] = n.getName();
			});
			result.ignoreMacs = result.devices.map(function(d) { return d.getMAC(); }).filter(Boolean);
			result.wanDevices = result.wans.map(function(n) { var d = n.getL3Device(); return d && d.getName(); }).filter(Boolean);
		}
		return result;
	}).finally(function() { delete pending[profile]; });
	return pending[profile];
}

return baseclass.extend({
	activity: function(device, since, id) { return activity(device, since || 0, id || ''); },
	traffic: function(device) {
		return deviceStatus(device).then(function(status) {
			var stats = status.statistics || {};
			if (stats.rx_bytes == null || stats.tx_bytes == null || !isFinite(stats.rx_bytes) || !isFinite(stats.tx_bytes)) throw new Error('Interface counters unavailable');
			return { device: device, rx: stats.rx_bytes, tx: stats.tx_bytes, time: Date.now() };
		});
	},
	overview: function() { return collect('overview'); },
	clients: function() { return collect('clients'); }
});
