/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require unifi.data as data';
'require unifi.client-model as model';
'require poll';
'require unifi.core as core';
'require unifi.icons as icons';
'require unifi.settings as settings';

var zh = /^zh/.test(document.documentElement.lang || navigator.language);
function t(cn, en) { return zh ? cn : en; }
// LuCI's E() parses a lone string child as HTML; wrap text in an array
// so lease host names and interface names are always inserted as text nodes.
function el(tag, cls, text) { return E(tag, { 'class': cls || '' }, text == null ? [] : [String(text)]); }
function pair(label, value) { return E('div', { 'class': 'uf-kv' }, [el('span', '', label), el('span', 'uf-value', value)]); }
function svgNode(tag, attrs) {
	var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
	Object.keys(attrs || {}).forEach(function(k) { n.setAttribute(k, attrs[k]); }); return n;
}
function gauge(label, percent, detail, cls) {
	var meter = el('div', 'uf-meter');
	meter.appendChild(E('span', { 'style': 'width:' + (percent == null ? 0 : percent).toFixed(1) + '%' }));
	return E('div', { 'class': 'uf-gauge ' + (cls || '') }, [pair(label, percent == null ? '—' : percent.toFixed(1) + '%'), meter, el('small', '', detail)]);
}

return baseclass.extend({
	mount: function(host) {
		this.unmount();
		if (!host) return Promise.reject(new Error('Dashboard host required'));
		var generation = this.generation;
		this.disposed = false;
		this.history = []; this.previous = null; this.previousCPU = null; this.duration = 300000; this.selected = null;
		this.data = null; this.busy = false; this.paused = false; this.optionNames = null;
		this.activityState = null; this.lastOverview = 0;
		this.chartBase = null; this.chartNow = null; this.chartDisplayMax = null; this.chartHover = null;
		return this.collect().then(L.bind(function(snapshot) {
			if (this.disposed || this.generation !== generation) return false;
			if (!snapshot.info && !snapshot.board) throw new Error('System metrics unavailable');
			this.root = this.layout();
			this.update(snapshot);
			this.lastOverview = Date.now();
			host.appendChild(this.root);
			return this.refreshActivity().catch(L.bind(function() {
				if (!this.disposed && this.generation === generation) this.refs.notice.textContent = t('流量数据暂不可用，下次自动重试。','Traffic data unavailable; retrying automatically.');
			}, this)).then(L.bind(function() {
				if (this.disposed || this.generation !== generation) return false;
				this.poller = L.bind(this.tick, this); poll.add(this.poller, 1);
				this.startChartAnimation();
				return true;
			}, this));
		}, this)).catch(L.bind(function(error) {
			if (this.generation === generation) this.unmount();
			throw error;
		}, this));
	},
	unmount: function() {
		this.disposed = true; this.generation = (this.generation || 0) + 1;
		this.stopChartAnimation();
		if (this.chartVisibility) document.removeEventListener('visibilitychange', this.chartVisibility);
		if (this.chartMotion && this.chartMotionChange) this.chartMotion.removeEventListener('change', this.chartMotionChange);
		this.chartVisibility = null; this.chartMotion = null; this.chartMotionChange = null;
		if (this.poller) poll.remove(this.poller);
		if (this.root) this.root.remove();
		this.poller = null; this.root = null;
	},
	collect: function() {
		return data.overview();
	},
	tick: function() {
		if (this.busy || this.paused || this.disposed || document.hidden) return Promise.resolve();
		this.busy = true; var generation = this.generation;
		// Network activity always updates every second. Other dashboard data
		// follows the configured interval, including every tick at the 1s default.
		var interval = Number(settings.get('dashboard_refresh'));
		var metrics = interval === 1 || Date.now() - this.lastOverview >= interval * 1000 ? this.collect().then(L.bind(function(d) {
			if (this.disposed || this.generation !== generation) return;
			if (!d.info) throw new Error('System metrics unavailable');
			this.update(d); this.lastOverview = Date.now();
		}, this)) : Promise.resolve();
		return metrics.then(L.bind(function() {
			if (!this.disposed && this.generation === generation) return this.refreshActivity();
		}, this)).catch(L.bind(function() {
			if (this.disposed || this.generation !== generation) return;
			this.previous = null; this.previousCPU = null;
			this.history.push({ time:Date.now(), down:null, up:null });
			this.history = this.history.filter(function(p) { return p.time >= Date.now() - 3600000; }).slice(-3601);
			this.refs.notice.textContent = t('更新失败，保留最后一次数据；下次自动重试。', 'Update failed. Showing the last sample; retrying automatically.');
		}, this)).finally(L.bind(function() { if (this.generation === generation) this.busy = false; }, this));
	},
	refreshActivity: function() {
		var device = this.selected, generation = this.generation;
		if (!device) return Promise.resolve();
		var current = L.bind(function() { return !this.disposed && this.generation === generation && this.selected === device; }, this);
		var foreground = L.bind(function(warning) {
			return data.traffic(device).then(L.bind(function(sample) {
				if (!current()) return;
				if (this.activityState) { this.activityState = null; this.history = []; this.previous = null; }
				var delta = core.delta(this.previous, sample); this.previous = sample;
				this.history.push({ time: sample.time, down: delta ? delta.down : null, up: delta ? delta.up : null });
				this.history = this.history.filter(function(p) { return p.time >= sample.time - 3600000; }).slice(-3601);
				this.renderTraffic(delta, sample.rx, sample.tx);
				this.refs.notice.textContent = warning || '';
			}, this));
		}, this);
		if (settings.get('activity_always') !== '1') return foreground('');
		var state = this.activityState || {};
		return data.activity(device, state.cursor, state.id).then(L.bind(function(result) {
			if (!current()) return;
			if (!result || !Array.isArray(result.samples) || result.device !== device) throw new Error('Invalid activity history');
			var merged = core.activityHistory(this.history, this.activityState, result, Date.now());
			this.history = merged.history; this.activityState = merged.state; this.previous = null;
			var latest = this.history[this.history.length - 1];
			var fresh = latest && Date.now() - latest.time <= 3000;
			this.renderTraffic(fresh ? latest : null, result.rx, result.tx);
			this.refs.notice.textContent = '';
		}, this)).catch(function() {
			if (current()) return foreground(t('后台采样暂不可用，当前仅采集网页打开期间的数据；下次自动重试。','Background sampling unavailable. Collecting while this page is open; retrying automatically.'));
		});
	},
	renderTraffic: function(delta, rx, tx) {
		this.refs.download.value.textContent = core.rate(delta && delta.down);
		this.refs.upload.value.textContent = core.rate(delta && delta.up);
		this.refs.download.detail.textContent = t('累计接收 ','Received total ') + core.bytes(rx);
		this.refs.upload.detail.textContent = t('累计发送 ','Transmitted total ') + core.bytes(tx);
		this.drawChart();
	},
	layout: function() {
		var self = this; this.refs = {};
		var side = el('aside', 'uf-summary'), content = el('div', 'uf-dashboard-main');
		var identity = el('section', 'uf-card uf-identity');
		var device = E('div', { 'class': 'uf-device-art', 'aria-hidden':'true' }, [el('span','uf-device-light'),el('i'),el('i'),el('i'),el('i')]);
		this.refs.hostname = el('h2', '', 'OpenWrt'); this.refs.model = el('p', 'uf-muted', '—');
		identity.appendChild(E('div', { 'class':'uf-device-title' }, [device, E('div', {}, [this.refs.hostname, this.refs.model])]));
		this.refs.identity = el('div'); identity.appendChild(this.refs.identity); side.appendChild(identity);
		var wan = E('section', { 'class':'uf-card' }, [el('h3','',t('互联网','Internet'))]); this.refs.wan = el('div'); wan.appendChild(this.refs.wan); side.appendChild(wan);
		var system = E('section', { 'class':'uf-card' }, [el('h3','',t('系统资源','System resources'))]); this.refs.resources = el('div'); system.appendChild(this.refs.resources); side.appendChild(system);
		var links = E('section', { 'class':'uf-card uf-shortcuts' }, [el('h3','',t('快捷访问','Quick access'))]);
		[[t('客户端设备','Client Devices'),'admin/unifi-clients'],[t('网络接口','Interfaces'),'admin/network/network'],[t('DHCP / DNS','DHCP / DNS'),'admin/network/dhcp'],[t('系统日志','System log'),'admin/status/syslog']].forEach(function(item) { links.appendChild(E('a', {'href':L.url.apply(L,item[1].split('/'))}, [item[0], icons.create('external')])); });
		links.appendChild(E('a', { 'href': L.url('admin', 'status', 'overview') }, [t('原生概览','Native overview'), icons.create('external')])); side.appendChild(links);
		var heading = E('div', { 'class':'uf-page-heading' }, el('h1','',t('仪表盘','Dashboard')));
		this.refs.updated = el('span','uf-updated','—');
		var pause = E('button', { 'type':'button','class':'uf-secondary-button','aria-pressed':'false','click':function() {
			self.paused = !self.paused; self.previous = null; self.previousCPU = null;
			pause.setAttribute('aria-pressed',String(self.paused)); pause.textContent = self.paused ? t('继续更新','Resume') : t('暂停更新','Pause');
			if (self.paused) self.stopChartAnimation();
			else { self.drawChart(); self.startChartAnimation(); self.tick(); }
		}}, t('暂停更新','Pause'));
		heading.appendChild(E('div', {'class':'uf-heading-actions'},[this.refs.updated,pause])); content.appendChild(heading);
		this.refs.notice = E('p', {'class':'uf-update-notice','role':'status'}); content.appendChild(this.refs.notice);
		var metrics = el('div','uf-metrics');
		[['download',t('下载速度','Download')],['upload',t('上传速度','Upload')],['cpu',t('CPU 使用率','CPU usage')],['memory',t('内存占用','Memory usage')]].forEach(function(item) {
			var value = el('strong','','—'), detail = el('small','uf-muted','—'); self.refs[item[0]] = {value:value,detail:detail};
			metrics.appendChild(E('section',{'class':'uf-metric'},[E('div',{'class':'uf-metric-label'},[el('span','',item[1]),E('span',{'class':'uf-metric-icon'},icons.create(item[0]))]),value,detail]));
		}); content.appendChild(metrics);
		var chart = el('section','uf-card uf-activity');
		var activityHead = E('div',{'class':'uf-section-heading'},[E('div',{},[el('h2','',t('网络活动','Network activity')),el('p','uf-muted',t('接口吞吐量 · 每 1 秒更新','Interface throughput · updates every second'))])]);
		this.refs.deviceSelect = E('select',{'class':'uf-device-select','aria-label':t('流量采集接口','Traffic interface'),'change':function(ev) {
			self.selected=ev.target.value;self.history=[];self.previous=null;self.activityState=null;self.chartHover=null;self.chartDisplayMax=null;self.renderTraffic(null,null,null);self.tick();
		}}); activityHead.appendChild(this.refs.deviceSelect); chart.appendChild(activityHead);
		var toolbar = el('div','uf-chart-toolbar');
		this.refs.legend = E('div',{'class':'uf-legend'},[el('span','uf-dot uf-dot-down'),el('span','',t('下载','Download')),el('span','uf-dot uf-dot-up'),el('span','',t('上传','Upload'))]); toolbar.appendChild(this.refs.legend);
		var range = E('div',{'class':'uf-segmented','aria-label':t('图表时间范围','Chart time range')});
		[[300000,t('5 分钟','5 min')],[900000,t('15 分钟','15 min')],[3600000,t('1 小时','1 hour')]].forEach(function(item) {
			var b = E('button',{'type':'button','class':self.duration===item[0]?'active':'','aria-pressed':String(self.duration===item[0]),'click':function() {self.duration=item[0];range.querySelectorAll('button').forEach(function(n){n.classList.toggle('active',n===b);n.setAttribute('aria-pressed',String(n===b));});self.drawChart();}},item[1]); range.appendChild(b);
		}); toolbar.appendChild(range); chart.appendChild(toolbar);
		var plot = el('div','uf-plot'); this.refs.chart = svgNode('svg', {'viewBox':'0 0 1000 235','preserveAspectRatio':'none','role':'img','aria-label':t('上传与下载吞吐量曲线','Upload and download throughput')});
		for(var n=0;n<5;n++){var y=n*235/4;this.refs.chart.appendChild(svgNode('line',{x1:0,x2:1000,y1:y,y2:y,'class':'uf-grid-line'}));}
		this.refs.series = svgNode('g', {'class':'uf-series-layer'}); this.refs.chart.appendChild(this.refs.series);
		this.refs.seriesPaths = { down: [], up: [] };
		this.refs.crosshair=svgNode('line',{x1:0,x2:0,y1:0,y2:235,'class':'uf-crosshair','visibility':'hidden'});this.refs.chart.appendChild(this.refs.crosshair);
		this.refs.empty = E('div',{'class':'uf-chart-empty','role':'status'},el('strong','',t('正在采集流量数据','Collecting traffic samples')));
		this.refs.axis = el('div','uf-chart-axis'); this.refs.tooltip = E('div',{'class':'uf-chart-tooltip','hidden':'','aria-hidden':'true'});
		this.refs.axisLabels=[];for(var j=0;j<5;j++){var label=el('span');this.refs.axisLabels.push(label);this.refs.axis.appendChild(label);}
		plot.addEventListener('pointermove',function(ev){self.hoverChart(ev);});plot.addEventListener('pointerleave',function(){self.chartHover=null;self.refs.tooltip.hidden=true;self.refs.crosshair.setAttribute('visibility','hidden');});
		plot.appendChild(this.refs.chart);plot.appendChild(this.refs.axis);plot.appendChild(this.refs.empty);plot.appendChild(this.refs.tooltip);chart.appendChild(plot);
		this.refs.chartFoot = el('div','uf-chart-foot');chart.appendChild(this.refs.chartFoot);content.appendChild(chart);
		var lower = el('div','uf-bottom-grid');
		var clients = el('section','uf-card uf-clients'); this.refs.clientCount=el('span','uf-count','—');
		clients.appendChild(E('div',{'class':'uf-section-heading'},[E('h2',{},[t('DHCP 租约','DHCP leases'),this.refs.clientCount]),E('a',{'href':L.url('admin','network','dhcp'),'class':'uf-icon-link'},[t('管理租约','Manage leases'),icons.create('external')])]));
		this.refs.search = E('input',{'type':'search','placeholder':t('搜索主机、IP 或 MAC','Search hostname, IP or MAC'),'aria-label':t('搜索 DHCP 租约','Search DHCP leases'),'input':function(){self.drawClients();}});clients.appendChild(this.refs.search);
		this.refs.clients=el('div','uf-table-scroll');clients.appendChild(this.refs.clients);lower.appendChild(clients);
		var interfaces=el('section','uf-card uf-interfaces');interfaces.appendChild(E('div',{'class':'uf-section-heading'},[el('h2','',t('接口状态','Interfaces')),E('a',{'href':L.url('admin','network','network'),'class':'uf-icon-link'},[t('管理接口','Manage interfaces'),icons.create('external')])]));this.refs.interfaces=el('div');interfaces.appendChild(this.refs.interfaces);lower.appendChild(interfaces);content.appendChild(lower);
		return E('section',{'id':'uf-dashboard','class':'uf-dashboard'},[side,content]);
	},
	update: function(data) {
		this.data = data; var b=data.board||{}, i=data.info||{}, mem=i.memory||{}, devices=data.devices.filter(function(d){return d.getName()!=='lo';});
		var wan=data.wans[0], wanDevice=wan&&wan.getL3Device();
		if(!this.selected)this.selected=wanDevice?wanDevice.getName():(devices[0]&&devices[0].getName());
		var options=devices.map(function(d){return d.getName();});if(wanDevice&&options.indexOf(wanDevice.getName())<0)options.push(wanDevice.getName());
		if(JSON.stringify(options)!==this.optionNames){this.refs.deviceSelect.replaceChildren();options.forEach(L.bind(function(name){this.refs.deviceSelect.appendChild(E('option',{'value':name},[name]));},this));this.optionNames=JSON.stringify(options);}
		this.refs.deviceSelect.value=this.selected||'';
		var now=Date.now();
		var cpu=core.cpuUsage(this.previousCPU,data.cpu);this.previousCPU=data.cpu;
		var available=mem.available!=null?mem.available:mem.free, used=mem.total!=null&&available!=null?mem.total-available:null, memory=core.percent(used,mem.total);
		this.refs.hostname.textContent=b.hostname||'OpenWrt';this.refs.model.textContent=b.model||b.system||'—';
		this.refs.identity.replaceChildren(pair(t('运行时间','Uptime'),core.uptime(i.uptime)),pair(t('固件版本','Firmware'),b.release&&b.release.version||'—'),pair(t('内核版本','Kernel'),b.kernel||'—'));
		var wanUp=!!(wan&&wan.isUp());
		this.refs.wan.replaceChildren(E('div',{'class':'uf-status-line'},[el('span','uf-dot '+(wanUp?'uf-dot-good':'uf-dot-muted')),el('strong','',wanUp?t('默认路由已连接','Default route connected'):t('未找到 IPv4 默认路由','No IPv4 default route'))]),pair(t('接口','Interface'),wan?wan.getName():'—'),pair(t('WAN 地址','WAN address'),wan?wan.getIPAddr()||'—':'—'),pair(t('网关','Gateway'),wan?wan.getGatewayAddr()||'—':'—'));
		var load=Array.isArray(i.load)?i.load.map(function(x){return (x/65535).toFixed(2);}).join(' / '):'—';
		this.refs.resources.replaceChildren(gauge(t('内存','Memory'),memory,core.bytes(used)+' / '+core.bytes(mem.total)),gauge(t('连接跟踪','Connection tracking'),core.percent(data.connections,data.maxConnections),data.connections==null?'—':data.connections+' / '+data.maxConnections),pair(t('系统负载','Load average'),load));
		this.refs.cpu.value.textContent=cpu==null?'—':cpu.toFixed(1)+'%';this.refs.cpu.detail.textContent=cpu==null?t('等待采样或数据不可用','Waiting for samples or data unavailable'):t('最近 ','Last ')+settings.get('dashboard_refresh')+t(' 秒',' seconds');
		this.refs.memory.value.textContent=memory==null?'—':memory.toFixed(1)+'%';this.refs.memory.detail.textContent=t('已用 ','Used ')+core.bytes(used);
		this.refs.updated.textContent=t('更新于 ','Updated ')+new Date(now).toLocaleTimeString(zh?'zh-CN':undefined, {hour:'2-digit',minute:'2-digit',second:'2-digit'});
		this.refs.interfaces.replaceChildren();devices.slice(0,8).forEach(L.bind(function(d){this.refs.interfaces.appendChild(E('div',{'class':'uf-interface-row'},[E('div',{},[el('strong','',d.getName()),el('small','uf-muted',d.getType()||'—')]),E('div',{'class':'uf-interface-info'},[el('span','uf-badge '+(d.isUp()?'uf-badge-good':''),d.isUp()?'UP':'DOWN'),E('small',{'class':'uf-muted uf-interface-counters','aria-label':t('接收 ','Received ')+core.bytes(d.getRXBytes())+t('，发送 ', ', transmitted ')+core.bytes(d.getTXBytes())},[icons.create('download'),core.bytes(d.getRXBytes()),icons.create('upload'),core.bytes(d.getTXBytes())])])]));},this));
		if(!devices.length)this.refs.interfaces.appendChild(el('p','uf-empty',t('接口数据不可用','Interface data unavailable')));
		this.drawClients();
	},
	drawClients: function() {
		var clients=model.leaseRows(this.data&&this.data.leases), filter=(this.refs.search.value||'').toLowerCase();
		this.refs.clientCount.textContent=clients?String(clients.length):'—';this.refs.clients.replaceChildren();
		if(!clients){this.refs.clients.appendChild(el('p','uf-empty',t('租约数据不可用','Lease data unavailable')));return;}
		var filtered=clients.filter(function(c){return (c.name+' '+c.ip+' '+c.mac).toLowerCase().indexOf(filter)>=0;});
		var table=E('table',{'class':'table uf-client-table'},E('thead',{},E('tr',{},[el('th','',t('主机名','Hostname')),el('th','','IP'),el('th','','MAC')]))),body=el('tbody');
		filtered.slice(0,12).forEach(function(c){body.appendChild(E('tr',{},[el('td','',c.name),el('td','uf-mono',c.ip),el('td','uf-mono uf-muted',c.mac)]));});table.appendChild(body);this.refs.clients.appendChild(table);
		if(!filtered.length)this.refs.clients.appendChild(el('p','uf-empty',filter?t('没有匹配的租约','No matching leases'):t('暂无 DHCP 租约','No DHCP leases')));
		if(filtered.length>12)this.refs.clients.appendChild(el('small','uf-muted','12 / '+filtered.length));
	},
	drawChart: function() {
		var now=Date.now(),start=now-this.duration,points=this.history.filter(function(p){return p.time>=start-2000;}),valid=points.filter(function(p){return p.down!=null;}),max=125000;
		points.forEach(function(p){max=Math.max(max,p.down||0,p.up||0);});max*=1.15;
		this.chartBase=now;this.chartScaleFrom=this.chartDisplayMax||max;this.chartScaleAt=now;this.chartTargetMax=max;
		// Cache real sample paths once per response. Animation only moves this
		// retained layer, revealing known line segments through the SVG viewport.
		[['down','uf-series-down'],['up','uf-series-up']].forEach(L.bind(function(item){
			var paths=core.series(points,item[0],1000,235,max,start,now,2000),nodes=this.refs.seriesPaths[item[0]];
			while(nodes.length>paths.length)this.refs.series.removeChild(nodes.pop());
			paths.forEach(L.bind(function(d,index){
				if(!nodes[index]){nodes[index]=svgNode('path',{'class':item[1]});this.refs.series.appendChild(nodes[index]);}
				nodes[index].setAttribute('d',d);
			},this));
		},this));
		this.refs.empty.hidden=valid.length>0;
		if(!valid.length){this.chartHover=null;this.refs.tooltip.hidden=true;}
		this.chartFootMinute=null;
		this.renderChartFrame(this.paused&&this.chartNow!=null?this.chartNow:now-(this.chartMotion&&this.chartMotion.matches?0:1000));
	},
	renderChartFrame: function(now) {
		if(this.chartBase==null)return;
		this.chartNow=now;
		var progress=this.chartMotion&&this.chartMotion.matches?1:Math.min(1,Math.max(0,(Date.now()-this.chartScaleAt)/300));
		progress=1-Math.pow(1-progress,3);
		this.chartDisplayMax=this.chartScaleFrom+(this.chartTargetMax-this.chartScaleFrom)*progress;
		var ratio=this.chartTargetMax/this.chartDisplayMax,x=(this.chartBase-now)/this.duration*1000;
		this.refs.series.setAttribute('transform','translate('+x.toFixed(4)+','+(235*(1-ratio)).toFixed(4)+') scale(1,'+ratio.toFixed(6)+')');
		this.refs.axisLabels.forEach(L.bind(function(label,index){var value=core.rate(this.chartDisplayMax*(4-index)/4);if(label.textContent!==value)label.textContent=value;},this));
		var minute=Math.floor(now/60000);
		if(this.chartFootMinute!==minute){
			this.chartFootMinute=minute;
			this.refs.chartFoot.textContent=new Date(now-this.duration).toLocaleTimeString(zh?'zh-CN':undefined,{hour:'2-digit',minute:'2-digit'})+' — '+new Date(now).toLocaleTimeString(zh?'zh-CN':undefined,{hour:'2-digit',minute:'2-digit'});
		}
		var hover=this.chartHover,hx=hover?(hover.time-(now-this.duration))/this.duration*1000:-1;
		this.refs.crosshair.setAttribute('visibility',hx>=0&&hx<=1000?'visible':'hidden');
		if(hx>=0&&hx<=1000){this.refs.crosshair.setAttribute('x1',hx);this.refs.crosshair.setAttribute('x2',hx);}
		else this.refs.tooltip.hidden=true;
	},
	startChartAnimation: function() {
		if(!this.chartMotion){
			this.chartMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
			this.chartVisibility=L.bind(function(){
				this.stopChartAnimation();
				if(!document.hidden&&!this.paused&&!this.disposed){this.drawChart();this.startChartAnimation();this.tick();}
			},this);
			this.chartMotionChange=L.bind(function(){this.stopChartAnimation();if(!this.disposed){this.drawChart();this.startChartAnimation();}},this);
			document.addEventListener('visibilitychange',this.chartVisibility);
			this.chartMotion.addEventListener('change',this.chartMotionChange);
			if(this.chartMotion.matches)this.drawChart();
		}
		if(this.disposed||this.paused||document.hidden||this.chartMotion.matches||this.chartFrame!=null)return;
		var generation=this.generation;
		var animate=L.bind(function(){
			this.chartFrame=null;
			if(this.disposed||this.generation!==generation||this.paused||document.hidden||this.chartMotion.matches)return;
			// A one-sample display buffer lets us reveal measured segments
			// continuously, without predicting traffic between RPC responses.
			this.renderChartFrame(Date.now()-1000);
			this.chartFrame=window.requestAnimationFrame(animate);
		},this);
		this.chartFrame=window.requestAnimationFrame(animate);
	},
	stopChartAnimation: function() {
		if(this.chartFrame!=null)window.cancelAnimationFrame(this.chartFrame);
		this.chartFrame=null;
	},
	hoverChart: function(ev) {
		var now=this.chartNow==null?Date.now():this.chartNow,rect=this.refs.chart.getBoundingClientRect(),ratio=(ev.clientX-rect.left)/rect.width,target=now-this.duration+ratio*this.duration;
		if(ratio<0||ratio>1)return;
		var best=null;this.history.forEach(function(p){if(p.time<=now&&p.down!=null&&(!best||Math.abs(p.time-target)<Math.abs(best.time-target)))best=p;});
		if(!best||Math.abs(best.time-target)>15000){this.chartHover=null;this.refs.tooltip.hidden=true;this.refs.crosshair.setAttribute('visibility','hidden');return;}
		this.chartHover=best;
		var x=Math.min(1000,Math.max(0,(best.time-(now-this.duration))/this.duration*1000));
		this.refs.crosshair.setAttribute('x1',x);this.refs.crosshair.setAttribute('x2',x);this.refs.crosshair.setAttribute('visibility','visible');
		this.refs.tooltip.textContent=new Date(best.time).toLocaleTimeString(zh?'zh-CN':undefined)+'\n'+t('下载 ','Download ')+core.rate(best.down)+'\n'+t('上传 ','Upload ')+core.rate(best.up);
		this.refs.tooltip.style.left=Math.max(0,Math.min(rect.width-150,ev.clientX-rect.left+12))+'px';this.refs.tooltip.style.top='24px';this.refs.tooltip.hidden=false;
	}
});
