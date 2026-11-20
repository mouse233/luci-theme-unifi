/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require view';
'require unifi.overview as dashboard';

return view.extend({
	render: function() {
		this.destroy();
		// The menu entry exists for every theme and, as the first admin entry, is the
		// page shown after login. Its styles ship with the Unifi theme only, so other
		// themes keep LuCI's own overview as their start page.
		if (!document.body.classList.contains('uf-theme')) {
			var overview = L.url('admin', 'status', 'overview');
			window.location.replace(overview);
			return E('p', {}, [E('a', { 'href': overview }, [_('Status')])]);
		}
		this.host = E('div', { 'class': 'uf-dashboard-host' });
		this.onHide = L.bind(this.deactivate, this);
		this.onShow = L.bind(function(ev) {
			if (ev.persisted) this.ready = this.activate().catch(L.bind(function(error) {
				this.host.textContent = _('Unable to load the dashboard. Please reload this page.');
				console.warn('Unifi dashboard:', error);
			}, this));
		}, this);
		window.addEventListener('pagehide', this.onHide);
		window.addEventListener('pageshow', this.onShow);
		this.ready = this.activate();
		return this.ready.then(L.bind(function() { return this.host; }, this));
	},
	activate: function() {
		this.deactivate();
		this.host.replaceChildren();
		return dashboard.mount(this.host).then(function(mounted) {
			if (mounted) document.body.classList.add('uf-dashboard-page');
		});
	},
	deactivate: function() {
		dashboard.unmount();
		document.body.classList.remove('uf-dashboard-page');
	},
	destroy: function() {
		this.deactivate();
		if (this.onHide) window.removeEventListener('pagehide', this.onHide);
		if (this.onShow) window.removeEventListener('pageshow', this.onShow);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
