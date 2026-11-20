/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require ui';
'require session';
'require unifi.settings as settings';

var paths = {
	'unifi-dashboard': 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0m4-1a5 5 0 0 1 10 0M12 12l-3-4m1 7h4',
	status: 'M3 4h18v13H3zM8 21h8m-4-4v4M6 11h3l2-4 3 7 2-3h2',
	network: 'M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6zM7 10v7h7m-4-10h4',
	system: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0',
	services: 'M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01M15 7.5h2M15 16.5h2',
	vpn: 'M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6zM9 12l2 2 4-4',
	nas: 'M3 5h18v14H3zM6 9h12M6 15h.01M10 15h.01',
	logout: 'M9 4H4v16h5m6-13 5 5-5 5m-6-5h11',
	clients: 'M3 4h12v10H3zM7 14v4m-3 0h9m5-10h4v12h-7V8h3m0 9h1',
	default: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'
};

function label(node) {
	return /^zh/.test(document.documentElement.lang) && ({
		'unifi-dashboard': '仪表盘', 'unifi-clients': '客户端设备', 'unifi-theme': 'Unifi 主题设置'
	}[node.name]) || _(node.title);
}

function icon(name) {
	var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'uf-icon uf-icon-nav'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
	svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('focusable', 'false');
	var p = document.createElementNS(svg.namespaceURI, 'path');
	p.setAttribute('d', paths[name] || paths.default); svg.appendChild(p); return svg;
}

return baseclass.extend({
	__init__: function() {
		var revision = 'unifi-navigation-2:' + (L.env.resource_version || '');
		var refresh = session.getLocalData('unifi-menu-version') !== revision;
		if (refresh) {
			// LuCI caches menus for the whole login session, across package upgrades.
			// flushCache() clears storage only; discard the in-memory copy as well.
			ui.menu.flushCache();
			ui.menu.menu = null;
		}
		this.ready = ui.menu.load().then(L.bind(function(tree) {
			this.render(tree);
			if (refresh) session.setLocalData('unifi-menu-version', revision);
		}, this)).catch(function() {
			// Page content stays visible; replace the empty menu with fixed links.
			document.body.classList.add('uf-menu-failed');
			return L.require('unifi.menu-fallback').then(function(fallback) { fallback.render(); }).catch(function() {});
		});
	},
	render: function(tree) {
		var modes = ui.menu.getChildren(tree), mode = modes.filter(function(x) { return x.name === L.env.dispatchpath[0]; })[0] || modes[0];
		if (!mode) return;
		var groups = ui.menu.getChildren(mode), current = L.env.dispatchpath || [], nav = document.getElementById('topmenu');
		if (!nav) return;
		nav.replaceChildren();
		// Pin the custom views first; retain LuCI's order and ACL-filtered groups.
		var custom = ['unifi-dashboard', 'unifi-clients'];
		groups = custom.map(function(name) { return groups.filter(function(group) { return group.name === name; })[0]; })
			.filter(Boolean).concat(groups.filter(function(group) { return custom.indexOf(group.name) < 0; }));
		nav.className = 'uf-navigation'; nav.setAttribute('aria-label', _('Main menu')); nav.style.display = '';
		var expanded = settings.get('nav_expanded')==='1';document.body.classList.toggle('uf-nav-expanded',expanded);
		var toggle = E('button', { 'class': 'uf-nav-toggle', 'type': 'button', 'title': _('Expand menu'), 'aria-expanded': String(expanded), 'click': function() {
			expanded = !expanded; document.body.classList.toggle('uf-nav-expanded', expanded); toggle.setAttribute('aria-expanded', String(expanded));
		}}, [icon('default'), E('span', { 'class': 'uf-nav-label' }, _('Navigation'))]);
		nav.appendChild(E('li', { 'class': 'uf-nav-toggle-item' }, toggle));
		groups.forEach(function(group) {
			var children = ui.menu.getChildren(group), active = current[1] === group.name, groupLabel = label(group), href = L.url(mode.name, group.name);
			if (!children.length) {
				nav.appendChild(E('li', {}, E('a', { 'class': 'uf-nav-item' + (active ? ' active' : ''), 'href': href, 'title': groupLabel }, [icon(group.name === 'unifi-clients' ? 'clients' : group.name), E('span', { 'class': 'uf-nav-label' }, [groupLabel])]))); return;
			}
			var details = E('details', { 'class': 'uf-nav-group' + (active ? ' active' : '') });
			var summary = E('summary', { 'title': groupLabel }, [icon(group.name), E('span', { 'class': 'uf-nav-label' }, [groupLabel])]);
			var list = E('div', { 'class': 'uf-nav-popover' }, E('p', { 'class': 'uf-nav-heading' }, [groupLabel]));
			children.forEach(function(child) {
				list.appendChild(E('a', { 'href': L.url(mode.name, group.name, child.name), 'class': current[1] === group.name && current[2] === child.name ? 'active' : '' }, [label(child)]));
			});
			details.appendChild(summary); details.appendChild(list);
			details.addEventListener('toggle', function() { if (details.open) nav.querySelectorAll('details[open]').forEach(function(other) { if (other !== details) other.open = false; }); });
			nav.appendChild(E('li', {}, details));
		});
		document.addEventListener('click', function(ev) { if (!nav.contains(ev.target)) nav.querySelectorAll('details[open]').forEach(function(d) { d.open = false; }); });
		document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') nav.querySelectorAll('details[open]').forEach(function(d) { d.open = false; d.firstElementChild.focus(); }); });
		var sub = tree.children && tree.children[mode.name];
		for (var i = 1; i < Math.min(3, current.length) && sub; i++) sub = sub.children && sub.children[current[i]];
		if (sub) this.tabs(sub, current.slice(0, i), i);
		var title = document.getElementById('uf-page-title');
		if (title) title.textContent = sub && sub.title ? label(sub) : _('Overview');

	},
	tabs: function(node, path, depth) {
		var children = ui.menu.getChildren(node), box = document.getElementById('tabmenu'), self = this;
		if (!box || !children.length) return;
		var ul = E('ul', { 'class': 'tabs' });
		children.forEach(function(child) {
			var active = L.env.dispatchpath[depth] === child.name;
			ul.appendChild(E('li', { 'class': active ? 'active' : '' }, E('a', { 'href': L.url.apply(L, path.concat(child.name)) }, [_(child.title)])));
			if (active) self.tabs(child, path.concat(child.name), depth + 1);
		});
		box.prepend(ul); box.style.display = '';
	}
});
