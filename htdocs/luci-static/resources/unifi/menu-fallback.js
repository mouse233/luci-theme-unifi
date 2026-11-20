/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';

// The header ships an empty, hidden #topmenu. When the menu tree cannot be
// loaded, show a few fixed links so every page still offers a way out.
var links = [
	['status', 'Status', ['admin', 'status', 'overview'], 'M3 4h18v13H3zM8 21h8m-4-4v4M6 11h3l2-4 3 7 2-3h2'],
	['network', 'Network', ['admin', 'network', 'network'], 'M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6zM7 10v7h7m-4-10h4'],
	['system', 'System', ['admin', 'system', 'system'], 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0'],
	['logout', 'Log out', ['admin', 'logout'], 'M9 4H4v16h5m6-13 5 5-5 5m-6-5h11']
];

function icon(d) {
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
	svg.setAttribute('class', 'uf-icon uf-icon-nav'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
	var path = document.createElementNS(svg.namespaceURI, 'path');
	path.setAttribute('d', d); svg.appendChild(path); return svg;
}

return baseclass.extend({
	render: function() {
		var nav = document.getElementById('topmenu');
		// Leave a partially rendered regular menu alone.
		if (!nav || nav.childElementCount) return;
		nav.className = 'uf-navigation uf-navigation-fallback';
		nav.setAttribute('aria-label', _('Main menu'));
		links.forEach(function(link) {
			var label = _(link[1]);
			nav.appendChild(E('li', {}, [E('a', { 'class': 'uf-nav-item', 'href': L.url.apply(L, link[2]), 'title': label },
				[icon(link[3]), E('span', { 'class': 'uf-nav-label' }, [label])])]));
		});
		nav.style.display = '';
	}
});
