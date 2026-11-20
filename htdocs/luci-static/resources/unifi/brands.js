/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require unifi.vendor-data as vendors';
'require unifi.brand-map as catalog';
'require unifi.icon-data as icons';

// Hostnames are hints, including user-assigned names. Never present a match
// as a verified hardware model. Local MACs are excluded from OUI lookups;
// QEMU's conventional local prefix is identified separately as a virtual NIC.
var rules = [
	[/iphone/i, 'apple', 'phone'], [/ipad/i, 'apple', 'tablet'],
	[/macbook|imac|mac[-_ ]?(mini|pro|studio)/i, 'apple', 'computer'],
	[/apple[-_ ]?tv/i, 'apple', 'tv'], [/homepod/i, 'apple', 'speaker'],
	[/apple[-_ ]?watch/i, 'apple', 'watch'],
	[/xiaomi|redmi|poco|mijia|miwifi|小米|红米/i, 'xiaomi', null],
	[/honor|荣耀/i, 'honor', null], [/huawei|matebook|matepad|华为/i, 'huawei', null],
	[/samsung|galaxy|^sm-[a-z]\d/i, 'samsung', null],
	[/oneplus|一加/i, 'oneplus', 'phone'], [/realme|^rmx\d/i, 'realme', 'phone'],
	[/oppo|^cph\d/i, 'oppo', 'phone'], [/vivo|iqoo/i, 'vivo', 'phone'],
	[/pixel|chromecast|nest[-_ ]?(hub|mini|audio|wifi)/i, 'google', null],
	[/kindle|amazon|alexa|fire[-_ ]?tv|^echo(?:[-_ ]|$)/i, 'amazon', null],
	[/playstation|^ps[345](?:[-_ ]|$)/i, 'playstation', 'game'],
	[/nintendo/i, 'nintendo', 'game'], [/xbox|surface/i, 'microsoft', null],
	[/bravia|^sony(?:[-_ ]|$)/i, 'sony', 'tv'],
	[/lenovo|thinkpad|thinkbook|legion/i, 'lenovo', 'computer'],
	[/^dell(?:[-_ ]|$)|inspiron|latitude|optiplex/i, 'dell', 'computer'],
	[/^hp[-_ ]|hewlett|laserjet|deskjet|officejet/i, 'hp', null],
	[/asus|zenbook|vivobook|^rog[-_ ]/i, 'asus', null],
	[/tp[-_ ]?link|^deco(?:[-_ ]|$)/i, 'tplink', 'network'],
	[/raspberry|^rpi(?:[-_ ]|$)|raspi/i, 'raspberrypi', 'computer'],
	[/synology|diskstation|^ds\d{3}/i, 'synology', 'storage'],
	[/espressif|esp32|esp8266|^esp[-_ ]/i, 'espressif', 'iot'],
	[/lgwebos|^lg[-_ ]/i, 'lg', 'tv'], [/^roku(?:[-_ ]|$)/i, 'roku', 'tv'],
	[/^dji(?:[-_ ]|$)/i, 'dji', null], [/unifi|ubiquiti|ubnt/i, 'ubiquiti', 'network'],
	[/hue[-_ ]?bridge|philips[-_ ]?hue/i, 'philipshue', 'iot'],
	[/hisense|vidaa|海信/i, 'hisense', 'tv'], [/^tcl(?:[-_ ]|$)/i, 'tcl', 'tv'],
	[/^zte(?:[-_ ]|$)|中兴/i, 'zte', 'network'],
	[/printer|打印机|epson|canon|brother/i, null, 'printer'],
	[/camera|ipcam|摄像|hikvision|ezviz/i, null, 'camera'],
	[/\btv\b|电视/i, null, 'tv'], [/speaker|sonos|音箱/i, null, 'speaker'],
	[/iphone|phone|android|手机/i, null, 'phone'], [/tablet|\bpad\b|平板/i, null, 'tablet'],
	[/nas|storage|存储/i, null, 'storage'], [/laptop|desktop|\bpc\b|电脑/i, null, 'computer'],
	[/home[-_ ]?assistant|smart[-_ ]?plug|zigbee/i, null, 'iot']
];
var tables = {};

function registryMatch(mac) {
	var sizes = [36, 28, 24];
	for (var n = 0; n < sizes.length; n++) {
		var bits = sizes[n], width = Math.ceil(bits / 8), stride = width + 2;
		if (!tables[bits]) {
			var decoded = atob(vendors.tables[bits]);
			var bytes = tables[bits] = new Uint8Array(decoded.length);
			for (var i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
		}
		var table = tables[bits], target = parseInt(mac.slice(0, bits / 4), 16) * (bits % 8 ? 16 : 1);
		var low = 0, high = table.length / stride - 1;
		while (low <= high) {
			var mid = (low + high) >>> 1, offset = mid * stride, prefix = 0;
			for (var j = 0; j < width; j++) prefix = prefix * 256 + table[offset + j];
			if (prefix < target) low = mid + 1;
			else if (prefix > target) high = mid - 1;
			else return vendors.names[(table[offset + width] << 8) | table[offset + width + 1]];
		}
	}
	return null;
}
var glyphs = {
	phone: 'M7 2h10v20H7zM10 19h4', tablet: 'M4 2h16v20H4zM11 19h2',
	computer: 'M2 3h20v14H2zM12 17v4M7 21h10', tv: 'M2 4h20v14H2zM8 21h8',
	printer: 'M6 8V2h12v6M5 18H2V8h20v10h-3M6 14h12v8H6zM18 11h1',
	camera: 'M3 6h18v14H3zM8 6l2-3h4l2 3M8 13a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
	storage: 'M3 3h18v7H3zM3 14h18v7H3zM6 6h1M6 17h1',
	speaker: 'M6 2h12v20H6zM9 14a3 3 0 1 0 6 0 3 3 0 0 0-6 0M11 6h2',
	game: 'M7 7h10c3 0 5 5 5 9s-3 4-6 0H8c-3 4-6 4-6 0s2-9 5-9M6 10v5M4 12.5h4M16 11h.1M19 14h.1',
	network: 'M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM6 9v9h9M9 6h6',
	watch: 'M8 2h8l1 5H7zM7 17h10l-1 5H8zM6 7h12v10H6z',
	iot: 'M5 5h14v14H5zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4'
};

function identify(hostname, address) {
	var mac = String(address || '').trim().replace(/[:.-]/g, '').toUpperCase();
	var valid = /^[0-9A-F]{12}$/.test(mac) && !(parseInt(mac.slice(0, 2), 16) & 1) && mac !== '000000000000';
	var result = { key: null, name: null, type: null, source: null, localMac: valid && !!(parseInt(mac.slice(0, 2), 16) & 2) };
	for (var i = 0; i < rules.length; i++) {
		if (rules[i][0].test(String(hostname || ''))) {
			result.key = rules[i][1]; result.type = rules[i][2]; result.source = 'hostname'; break;
		}
	}
	if (valid && result.localMac && mac.slice(0, 6) === '525400') {
		result.key = 'qemu'; result.type = 'computer'; result.source = 'virtual';
	}
	if (valid && !result.localMac) {
		var organization = registryMatch(mac);
		if (organization) {
			// The IEEE export carries a few names HTML-escaped ("R&amp;M AG"). Keep the
			// registry string for lookups, show the decoded name as text.
			result.name = organization.replace(/&amp;/g, '&');
			result.key = Object.prototype.hasOwnProperty.call(catalog.organizations, organization) ? catalog.organizations[organization] : null;
			result.source = 'mac';
		}
	}
	var brand = catalog.brands[result.key];
	if (brand) {
		result.name = result.name || brand.name;
		result.brand = brand.name || null;
		result.type = result.type || brand.type || null;
		if (!brand.name) result.key = null;
	}
	return result;
}

function avatar(identity, large, label) {
	var brand = catalog.brands[identity.key], paths = brand && icons.paths[brand.icon];
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	var node = E('span', { 'class': 'uf-client-avatar' + (brand ? ' uf-brand-avatar' : '') + (large ? ' large' : ''),
		'title': label, 'aria-hidden': 'true', 'data-brand': identity.key || '' });
	if (brand && brand.color) node.style.color = brand.color;
	if (brand && !paths) node.appendChild(E('b', {}, [brand.letter || (brand.name || identity.name || '?').charAt(0)]));
	else {
		svg.setAttribute('viewBox', '0 0 24 24');
		if (!brand) { svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4'); }
		else svg.setAttribute('fill', 'currentColor');
		(paths || [glyphs[identity.type] || glyphs.computer]).forEach(function(path) {
			var p = document.createElementNS(svg.namespaceURI, 'path'); p.setAttribute('d', path); svg.appendChild(p);
		});
		node.appendChild(svg);
	}
	return node;
}

return baseclass.extend({ identify: identify, avatar: avatar });
