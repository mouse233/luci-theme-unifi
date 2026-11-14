/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';

function mac(value) {
	var s=String(value||'').replace(/-/g,':').toUpperCase();
	return /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(s)&&s!=='00:00:00:00:00:00'&&!(parseInt(s.slice(0,2),16)&1)?s:null;
}
function array(x){return Array.isArray(x)?x:(x==null?[]:[x]);}
function unique(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i;});}
function addresses(list){return array(list).map(function(x){return typeof x==='string'?x:(x&&x.address)||'';}).filter(Boolean);}
function ipKey(ip){var p=String(ip||'').split('.');return p.length===4&&p.every(function(n){return /^\d+$/.test(n)&&+n<=255;})?p.reduce(function(n,v){return n*256+(+v);},0):null;}

return baseclass.extend({
	mac:mac,
	parseARP:function(text){
		return String(text||'').split(/\n/).slice(1).map(function(line){var p=line.trim().split(/\s+/);return {ip:p[0],flags:parseInt(p[2],16),mac:mac(p[3]),device:p[5]};}).filter(function(x){return x.mac&&ipKey(x.ip)!=null&&(x.flags&2)&&x.device;});
	},
	merge:function(data){
		var rows=Object.create(null),arp=this.parseARP(data.arp),ignored=array(data.ignoreMacs).map(mac).filter(Boolean),wan=array(data.wanDevices);
		function get(m,duid){
			m=mac(m);var id=m||(duid?'duid:'+duid:null);if(!id||ignored.indexOf(m)>=0)return null;
			return rows[id]||(rows[id]={id:id,mac:m,name:'',ipv4:[],ipv6:[],networks:[],sources:[],associated:false,neighbor:false,reserved:false,lease:false,leaseValid:false,signal:null,rxRate:null,txRate:null,inactive:null,expires:null,device:'',ssid:'',channel:null});
		}
		function source(r,s){if(r.sources.indexOf(s)<0)r.sources.push(s);}
		Object.keys(data.hints||{}).forEach(function(m){var h=data.hints[m]||{},r=get(m);if(!r)return;r.name=h.name||'';r.ipv4=r.ipv4.concat(addresses(h.ipaddrs));r.ipv6=r.ipv6.concat(addresses(h.ip6addrs||h.ipv6addrs));source(r,'hint');});
		['dhcp_leases','dhcp6_leases'].forEach(function(key){array((data.leases||{})[key]).forEach(function(l){var r=get(l.macaddr,l.duid);if(!r)return;r.name=r.name||l.hostname||'';r.ipv4=r.ipv4.concat(addresses(l.ipaddr));r.ipv6=r.ipv6.concat(addresses(l.ip6addrs));r.lease=true;r.leaseValid=r.leaseValid||l.expires===-1||Number(l.expires)>0;r.expires=l.expires==null?r.expires:Number(l.expires);source(r,'lease');});});
		array(data.statics).forEach(function(s){array(s.mac).join(' ').split(/\s+/).forEach(function(m){var r=get(m);if(!r)return;r.reserved=true;r.name=s.name||r.name;if(s.ip&&s.ip!=='ignore')r.ipv4.push(s.ip);source(r,'static');});});
		arp.forEach(function(a){if(wan.indexOf(a.device)>=0)return;var r=get(a.mac);if(!r)return;r.neighbor=true;r.device=a.device;r.ipv4.push(a.ip);r.networks.push((data.deviceNetworks||{})[a.device]||a.device);source(r,'neighbor');});
		array(data.wifi).forEach(function(s){var r=get(s.mac);if(!r)return;r.associated=true;source(r,'wifi');
			if(r.signal==null||(s.signal!=null&&s.signal>r.signal)){r.signal=s.signal<0?Number(s.signal):null;r.device=s.device||r.device;r.ssid=s.ssid||'';r.channel=s.channel||null;r.rxRate=s.rx&&Number(s.rx.rate)>0?Number(s.rx.rate):null;r.txRate=s.tx&&Number(s.tx.rate)>0?Number(s.tx.rate):null;r.inactive=s.inactive==null?null:Number(s.inactive);}
			r.networks=r.networks.concat(array(s.networks));
		});
		var wanMacs=arp.filter(function(a){return wan.indexOf(a.device)>=0;}).map(function(a){return a.mac;});
		return Object.keys(rows).map(function(id){var r=rows[id];r.ipv4=unique(r.ipv4);r.ipv6=unique(r.ipv6);r.networks=unique(r.networks);var presence=(data.presence||{})[r.mac]||{};r.status=presence.status==='online'||presence.status==='offline'?presence.status:'unknown';r.lastSeen=Number(presence.last_seen)>0?Number(presence.last_seen):null;r.localMac=!!(r.mac&&(parseInt(r.mac.slice(0,2),16)&2));return r;}).filter(function(r){return wanMacs.indexOf(r.mac)<0||r.neighbor||r.associated||r.reserved||r.lease;});
	},
	query:function(rows,state){
		var search=String(state.search||'').trim().toLowerCase();
		var filtered=rows.filter(function(r){
			if(state.group==='associated'&&!r.associated)return false;
			if(state.group==='neighbor'&&!r.neighbor)return false;
			if(state.group==='lease'&&!r.lease)return false;
			if(state.group==='static'&&!r.reserved)return false;
			if(state.connection==='wifi'&&!r.associated)return false;
			if(state.connection==='other'&&r.associated)return false;
			if(state.network&&r.networks.indexOf(state.network)<0)return false;
			return !search||[r.name,r.mac,r.id,r.device,r.ssid,r.identity&&r.identity.name,r.identity&&r.identity.brand].concat(r.ipv4,r.ipv6,r.networks).join(' ').toLowerCase().indexOf(search)>=0;
		});
		var key=state.sort||'name',direction=state.direction==='desc'?-1:1;
		return filtered.slice().sort(function(a,b){
			var av=key==='ip'?a.ipv4[0]:key==='vendor'?(a.identity&&a.identity.name):a[key],bv=key==='ip'?b.ipv4[0]:key==='vendor'?(b.identity&&b.identity.name):b[key];
			if(av==null||av==='')return bv==null||bv===''?a.id.localeCompare(b.id):1;
			if(bv==null||bv==='')return -1;
			if(key==='ip'&&ipKey(av)!=null&&ipKey(bv)!=null)return (ipKey(av)-ipKey(bv))*direction;
			return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true}))*direction||a.id.localeCompare(b.id);
		});
	},
	leaseRows: function(data) {
		if (!data) return null;
		var rows = [], seen = {};
		(data.dhcp_leases || []).concat(data.dhcp6_leases || []).forEach(function(lease) {
			var id = lease.macaddr || lease.duid || lease.ipaddr || (lease.ip6addrs || [])[0];
			if (!id || seen[id.toLowerCase()]) return;
			seen[id.toLowerCase()] = true;
			rows.push({ name: lease.hostname || '—', ip: lease.ipaddr || (lease.ip6addrs || []).join(', ') || '—', mac: lease.macaddr || '—', expires: lease.expires });
		});
		return rows;
	},
	csv:function(headers,rows){
		function cell(value){var s=String(value==null?'':value);if(/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
		return '\uFEFF'+[headers].concat(rows).map(function(row){return row.map(cell).join(',');}).join('\r\n');
	}
});
