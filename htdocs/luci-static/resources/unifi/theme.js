/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';

// Native LuCI pages only receive navigation and theme styles.
return baseclass.extend({
	__init__: function() {
		this.ready = L.require('menu-unifi').catch(function(error) {
			document.body.classList.add('uf-menu-failed');
			console.warn('Unifi navigation:', error);
			return L.require('unifi.menu-fallback').then(function(fallback) { fallback.render(); }).catch(function() {});
		});
	}
});
