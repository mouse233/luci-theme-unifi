/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require baseclass';
'require unifi.data as data';
'require poll';
'require unifi.core as core';
'require unifi.client-model as model';
'require unifi.brands as brands';
'require unifi.settings as settings';
'require unifi.icons as icons';

var chinese=/^zh/.test(document.documentElement.lang||navigator.language);
function t(zh,en){return chinese?zh:en;}
// LuCI's E() parses a lone string child as HTML; always pass an array
// so that host names, SSIDs and vendor names are inserted as text nodes.
function node(tag,cls,content){return E(tag,{'class':cls||''},content==null?[]:Array.isArray(content)?content:[content]);}
function rate(kbps){return kbps==null?'—':(kbps>=1000?(kbps/1000).toFixed(1)+' Mbps':kbps.toFixed(0)+' Kbps');}
function ago(ms){return ms==null?'—':ms<1000?t('刚刚','Just now'):ms<60000?Math.floor(ms/1000)+t(' 秒前','s ago'):Math.floor(ms/60000)+t(' 分钟前','m ago');}
function status(row){return {online:t('在线','Online'),offline:t('离线','Offline'),unknown:'—'}[row.status]||'—';}
function name(row){return row.name||t('未知设备','Unknown device');}
function identitySource(id){return id.source==='hostname'?t('主机名推测','Hostname hint'):id.source==='mac'?t('MAC 前缀匹配','MAC prefix match'):id.source==='virtual'?t('虚拟网卡前缀匹配','Virtual NIC prefix match'):t('未识别','Not identified');}
function deviceType(type){return {phone:t('手机','Phone'),tablet:t('平板','Tablet'),computer:t('电脑','Computer'),tv:t('电视','TV'),printer:t('打印机','Printer'),camera:t('摄像头','Camera'),storage:t('存储设备','Storage'),speaker:t('音箱','Speaker'),game:t('游戏机','Game console'),network:t('网络设备','Network device'),watch:t('手表','Watch'),iot:t('智能设备','Smart device')}[type]||t('未知','Unknown');}
function sourceName(s){return {hint:t('主机提示','Host hints'),neighbor:t('ARP 邻居','ARP neighbor'),lease:'DHCP',static:t('静态租约','Reservation'),wifi:t('无线关联','Wi-Fi association')}[s]||s;}
var columns=[
	{key:'name',title:t('名称','Name'),fixed:true},
	{key:'vendor',title:t('厂商','Vendor')},
	{key:'status',title:t('状态','Status')},
	{key:'connection',title:t('连接','Connection')},
	{key:'networks',title:t('网络','Network')},
	{key:'ip',title:t('IP 地址','IP address')},
	{key:'mac',title:t('MAC 地址','MAC address')},
	{key:'ipv6',title:t('IPv6 地址','IPv6 address')},
	{key:'signal',title:t('信号','Signal')},
	{key:'rxRate',title:t('接收链路','RX link rate')},
	{key:'txRate',title:t('发送链路','TX link rate')},
	{key:'inactive',title:t('最近活动','Last activity')},
	{key:'assignment',title:t('地址分配','Assignment')}
];
var defaults={main:['name','vendor','status','connection','networks','ip','signal','rxRate','txRate','inactive'],ip:['name','vendor','status','mac','ip','ipv6','assignment']};

return baseclass.extend({
	load:function(){
		return data.clients();
	},
	render:function(data){
		this.state={mode:'main',group:'all',connection:'all',network:'',search:'',sort:'name',direction:'asc',page:1,size:Number(settings.get('page_size'))};
		this.selected=new Set();this.currentId=null;this.busy=false;this.disposed=false;this.prefs={};this.refs={};
		this.storageKey='unifi-clients-columns-v1';
		try{this.prefs=JSON.parse(localStorage.getItem(this.storageKey)||'{}')||{};}catch(e){}
		if(!this.prefs||typeof this.prefs!=='object'||Array.isArray(this.prefs))this.prefs={};
		document.body.classList.add('uf-clients-page');
		var root=this.layout();this.accept(data);
		this.poller=L.bind(function(){if(!document.hidden&&!this.busy)return this.refresh();},this);
		poll.add(this.poller,Number(settings.get('client_refresh')));
		window.addEventListener('pagehide',L.bind(function(){this.disposed=true;poll.remove(this.poller);},this));
		// A page restored from the back/forward cache must resume polling and manual refresh.
		window.addEventListener('pageshow',L.bind(function(ev){if(!ev.persisted||!this.disposed)return;this.disposed=false;poll.add(this.poller,Number(settings.get('client_refresh')));this.refresh();},this));
		return root;
	},
	activeColumns:function(){
		var list=this.prefs[this.state.mode];if(!Array.isArray(list))list=defaults[this.state.mode];
		return columns.filter(function(c){return c.fixed||list.indexOf(c.key)>=0;});
	},
	layout:function(){
		var self=this;
		var sidebar=node('aside','uf-client-filters'),main=node('section','uf-client-workspace');
		var modes=node('div','uf-client-modes');
		[['main',t('主','Main')],['ip',t('IP 表','IP table')]].forEach(function(item){
			var button=E('button',{'type':'button','aria-pressed':String(item[0]==='main'),'click':function(){self.state.mode=item[0];modes.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});self.renderColumnOptions();self.paint();}},item[1]);modes.appendChild(button);
		});sidebar.appendChild(modes);
		sidebar.appendChild(node('h3','uf-filter-heading',t('客户端设备','Client devices')));
		this.refs.groups={};
		[['all',t('全部记录','All records')],['associated',t('WiFi 已关联','Wi-Fi associated')],['neighbor',t('邻居记录','Neighbors')],['lease',t('DHCP 租约','DHCP leases')],['static',t('静态租约','Reservations')]].forEach(function(item){
			var count=node('span','uf-filter-count','0');var button=E('button',{'type':'button','class':'uf-client-filter'+(item[0]==='all'?' active':''),'aria-pressed':String(item[0]==='all'),'click':function(){self.state.group=item[0];self.state.page=1;Object.keys(self.refs.groups).forEach(function(k){self.refs.groups[k].button.classList.toggle('active',k===item[0]);self.refs.groups[k].button.setAttribute('aria-pressed',String(k===item[0]));});self.paint();}},[node('span','',item[1]),count]);
			self.refs.groups[item[0]]={button:button,count:count};sidebar.appendChild(button);
		});
		var filterFields=node('div','uf-client-filter-fields');
		this.refs.connection=E('select',{'aria-label':t('连接类型','Connection type'),'change':function(e){self.state.connection=e.target.value;self.state.page=1;self.paint();}},[
			E('option',{value:'all'},t('全部连接','All connections')),E('option',{value:'wifi'},'Wi-Fi'),E('option',{value:'other'},t('其他 / 未知','Other / unknown'))]);
		this.refs.network=E('select',{'aria-label':t('筛选网络','Filter network'),'change':function(e){self.state.network=e.target.value;self.state.page=1;self.paint();}});
		filterFields.appendChild(node('label','',t('连接','Connection')));filterFields.appendChild(this.refs.connection);filterFields.appendChild(node('label','',t('网络','Network')));filterFields.appendChild(this.refs.network);sidebar.appendChild(filterFields);
		var actions=node('div','uf-client-side-actions');
		actions.appendChild(E('a',{href:L.url('admin','network','dhcp'),'class':'uf-icon-link'},[t('管理静态租约','Manage reservations'),icons.create('external')]));
		this.refs.columnDetails=E('details',{'class':'uf-client-columns'});
		this.refs.columnDetails.appendChild(E('summary',{},t('自定义列','Customize columns')));
		this.refs.columnDetails.addEventListener('toggle',function(){if(self.refs.columnDetails.open)self.closeDetail();});
		this.refs.columnOptions=node('div','uf-client-column-options');this.refs.columnDetails.appendChild(this.refs.columnOptions);actions.appendChild(this.refs.columnDetails);sidebar.appendChild(actions);
		var title=node('div','uf-client-title');this.refs.total=node('span','uf-client-total','0');
		title.appendChild(E('h1',{},[t('客户端设备','Client devices'),this.refs.total]));this.refs.updated=node('span','uf-muted','');title.appendChild(this.refs.updated);main.appendChild(title);
		var toolbar=node('div','uf-client-toolbar');
		this.refs.search=E('input',{'type':'search','placeholder':t('搜索名称、IP 或 MAC 地址','Search name, IP or MAC address'),'aria-label':t('搜索客户端','Search clients'),'input':function(e){self.state.search=e.target.value;self.state.page=1;self.paint();}});toolbar.appendChild(this.refs.search);
		this.refs.resultCount=node('span','uf-client-result-count','');toolbar.appendChild(this.refs.resultCount);
		this.refs.exportButton=E('button',{'type':'button','class':'uf-secondary-button','click':function(){self.exportCSV();}},t('导出 CSV','Export CSV'));toolbar.appendChild(this.refs.exportButton);
		this.refs.refresh=E('button',{'type':'button','class':'uf-secondary-button','click':function(){self.refresh();}},t('刷新','Refresh'));toolbar.appendChild(this.refs.refresh);main.appendChild(toolbar);
		this.refs.notice=E('p',{'class':'uf-client-notice','role':'status'});main.appendChild(this.refs.notice);
		this.refs.selection=node('div','uf-client-selection');main.appendChild(this.refs.selection);
		this.refs.scroll=E('div',{'class':'uf-client-table-scroll','tabindex':'0','aria-label':t('客户端设备表格，可横向滚动','Client table, horizontally scrollable')});
		this.refs.table=E('table',{'class':'uf-devices-table','aria-label':t('客户端设备列表','Client devices list')});this.refs.scroll.appendChild(this.refs.table);main.appendChild(this.refs.scroll);
		this.refs.empty=node('div','uf-client-empty');main.appendChild(this.refs.empty);
		var footer=node('div','uf-client-pagination');
		this.refs.pageInfo=node('span','','');footer.appendChild(this.refs.pageInfo);
		var pageControls=node('div','uf-client-page-controls');
		this.refs.pageSize=E('select',{'aria-label':t('每页条数','Rows per page'),'change':function(e){self.state.size=Number(e.target.value);self.state.page=1;self.paint();}},[10,25,50,100].map(function(n){return E('option',{value:n},n+t(' 条 / 页',' / page'));}));this.refs.pageSize.value=String(this.state.size);pageControls.appendChild(this.refs.pageSize);
		this.refs.prev=E('button',{'type':'button','class':'uf-secondary-button','aria-label':t('上一页','Previous page'),'click':function(){self.state.page--;self.paint();}},icons.create('chevron-left'));
		this.refs.next=E('button',{'type':'button','class':'uf-secondary-button','aria-label':t('下一页','Next page'),'click':function(){self.state.page++;self.paint();}},icons.create('chevron-right'));pageControls.appendChild(this.refs.prev);this.refs.pageNumber=node('span','','1');pageControls.appendChild(this.refs.pageNumber);pageControls.appendChild(this.refs.next);footer.appendChild(pageControls);main.appendChild(footer);
		this.refs.drawer=E('aside',{'class':'uf-client-drawer','role':'dialog','aria-modal':'false','aria-label':t('设备详情','Device details'),'hidden':''});
		this.refs.drawerName=node('h2','','');var drawerHeader=node('div','uf-client-drawer-header');drawerHeader.appendChild(this.refs.drawerName);
		this.refs.close=E('button',{'type':'button','aria-label':t('关闭设备详情','Close device details'),'click':function(){self.closeDetail();}},icons.create('close'));drawerHeader.appendChild(this.refs.close);this.refs.drawer.appendChild(drawerHeader);this.refs.drawerContent=node('div','uf-client-drawer-content');this.refs.drawer.appendChild(this.refs.drawerContent);
		document.addEventListener('keydown',function(e){if(e.key==='Escape'){self.closeDetail();if(self.refs.columnDetails.open){self.refs.columnDetails.open=false;self.refs.columnDetails.querySelector('summary').focus();}}});
		this.renderColumnOptions();
		return E('div',{'class':'uf-clients-layout'},[sidebar,main,this.refs.drawer]);
	},
	renderColumnOptions:function(){
		var self=this,visible=this.activeColumns().map(function(c){return c.key;});this.refs.columnOptions.replaceChildren(node('strong','',t('显示列','Visible columns')));
		columns.forEach(function(c){var input=E('input',{'type':'checkbox','aria-label':t('显示列：','Show column: ')+c.title,'change':function(){
			var values=new Set(self.activeColumns().map(function(k){return k.key;}));if(input.checked)values.add(c.key);else values.delete(c.key);self.prefs[self.state.mode]=Array.from(values);
			try{localStorage.setItem(self.storageKey,JSON.stringify(self.prefs));}catch(e){}self.paint();
		}});input.checked=visible.indexOf(c.key)>=0;input.disabled=!!c.fixed;self.refs.columnOptions.appendChild(E('label',{},[input,c.title]));});
		this.refs.columnOptions.appendChild(E('button',{'type':'button','class':'uf-text-button','click':function(){delete self.prefs[self.state.mode];try{localStorage.setItem(self.storageKey,JSON.stringify(self.prefs));}catch(e){}self.renderColumnOptions();self.paint();}},t('恢复默认列','Reset columns')));
		this.refs.columnOptions.appendChild(E('button',{'type':'button','class':'uf-secondary-button','click':function(){self.refs.columnDetails.open=false;self.refs.columnDetails.querySelector('summary').focus();}},t('完成','Done')));
	},
	accept:function(data){
		this.data=data;this.rows=model.merge(data).map(function(row){row.identity=brands.identify(row.name,row.mac);return row;});var ids=new Set(this.rows.map(function(r){return r.id;}));this.selected.forEach(L.bind(function(id){if(!ids.has(id))this.selected.delete(id);},this));
		this.refs.total.textContent=String(this.rows.length);var rows=this.rows;
		Object.keys(this.refs.groups).forEach(L.bind(function(g){this.refs.groups[g].count.textContent=String(g==='all'?rows.length:rows.filter(function(r){return g==='associated'?r.associated:g==='neighbor'?r.neighbor:g==='lease'?r.lease:r.reserved;}).length);},this));
		var nets=[];rows.forEach(function(r){r.networks.forEach(function(n){if(nets.indexOf(n)<0)nets.push(n);});});nets.sort();
		if(JSON.stringify(nets)!==this.networkNames){this.refs.network.replaceChildren(E('option',{value:''},t('全部网络','All networks')));nets.forEach(L.bind(function(n){this.refs.network.appendChild(E('option',{value:n},[n]));},this));this.networkNames=JSON.stringify(nets);}
		if(this.state.network&&nets.indexOf(this.state.network)<0)this.state.network='';this.refs.network.value=this.state.network;
		this.refs.notice.textContent=data.unavailable&&data.unavailable.length?t('部分数据源不可用：','Some sources are unavailable: ')+data.unavailable.map(function(key){return {presence:t('在线状态','Online status'),leases:'DHCP',hints:t('主机提示','Host hints'),arp:t('邻居记录','Neighbors'),statics:t('静态租约','Reservations'),wifi:t('无线关联','Wi-Fi associations'),devices:t('设备','Devices'),wans:t('上行网络','WAN networks'),networks:t('网络','Networks')}[key]||key;}).join(' · '):'';
		this.refs.updated.textContent=t('更新于 ','Updated ')+new Date().toLocaleTimeString(chinese?'zh-CN':undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
		this.paint();if(this.currentId){var current=this.rows.find(L.bind(function(r){return r.id===this.currentId;},this));if(current)this.detail(current,false);else this.closeDetail();}
	},
	refresh:function(){
		if(this.busy||this.disposed)return Promise.resolve();this.busy=true;this.refs.refresh.disabled=true;this.refs.refresh.textContent=t('更新中…','Refreshing…');
		return this.load().then(L.bind(this.accept,this)).catch(L.bind(function(){this.refs.notice.textContent=t('更新失败，当前显示上次结果。','Update failed. Showing the previous results.');},this)).finally(L.bind(function(){this.busy=false;this.refs.refresh.disabled=false;this.refs.refresh.textContent=t('刷新','Refresh');},this));
	},
	paint:function(){
		var self=this,filtered=model.query(this.rows,this.state),cols=this.activeColumns();this.filtered=filtered;
		var active=document.activeElement,focusLabel=null,focusRow=null;
		if(this.refs.table.contains(active)){focusLabel=active.getAttribute('aria-label');var parentRow=active.closest('tr[data-client-id]');focusRow=parentRow&&parentRow.getAttribute('data-client-id');}
		var pages=Math.max(1,Math.ceil(filtered.length/this.state.size));this.state.page=Math.min(pages,Math.max(1,this.state.page));
		var start=(this.state.page-1)*this.state.size,current=filtered.slice(start,start+this.state.size);this.refs.table.replaceChildren();
		var thead=node('thead'),head=node('tr');
		var select=E('input',{'type':'checkbox','aria-label':t('选择当前页','Select current page'),'change':function(){current.forEach(function(r){if(select.checked)self.selected.add(r.id);else self.selected.delete(r.id);});self.paint();}});
		select.checked=!!current.length&&current.every(function(r){return self.selected.has(r.id);});select.indeterminate=!select.checked&&current.some(function(r){return self.selected.has(r.id);});select.disabled=!current.length;head.appendChild(E('th',{'class':'uf-client-check'},select));
		cols.forEach(function(c){var sortKey=['name','vendor','ip','mac','signal','rxRate','txRate','inactive','status'].indexOf(c.key)>=0?c.key:null;
			var th=E('th',{'scope':'col','class':'uf-client-col-'+c.key});
			if(sortKey){th.setAttribute('aria-sort',self.state.sort===sortKey?(self.state.direction==='asc'?'ascending':'descending'):'none');th.appendChild(E('button',{'type':'button','aria-label':t('按','Sort by ')+c.title+t('排序',''),'click':function(){self.state.direction=self.state.sort===sortKey&&self.state.direction==='asc'?'desc':'asc';self.state.sort=sortKey;self.state.page=1;self.paint();}},[c.title,node('span','uf-sort-indicator',icons.create(self.state.sort===sortKey?(self.state.direction==='asc'?'sort-up':'sort-down'):'sort'))]));}else th.textContent=c.title;head.appendChild(th);
		});thead.appendChild(head);this.refs.table.appendChild(thead);
		var body=node('tbody');
		current.forEach(function(r){
			var tr=E('tr',{'data-client-id':r.id,'class':self.selected.has(r.id)?'uf-client-selected':''});
			var check=E('input',{'type':'checkbox','aria-label':t('选择 ','Select ')+name(r),'click':function(e){e.stopPropagation();},'change':function(){if(check.checked)self.selected.add(r.id);else self.selected.delete(r.id);self.paint();}});check.checked=self.selected.has(r.id);tr.appendChild(E('td',{'class':'uf-client-check'},check));
			cols.forEach(function(c){var cell=E('td',{'class':'uf-client-col-'+c.key});cell.appendChild(self.cell(r,c.key));tr.appendChild(cell);});
			tr.addEventListener('click',function(e){if(!e.target.closest('input,button,a'))self.detail(r,true);});body.appendChild(tr);
		});this.refs.table.appendChild(body);
		this.refs.empty.hidden=!!filtered.length;
		if(!filtered.length){this.refs.empty.replaceChildren(node('div','uf-client-empty-icon',icons.create('search')),node('h2','',this.rows.length?t('没有匹配的客户端','No matching clients'):t('暂无客户端记录','No client records')));
			if(this.rows.length)this.refs.empty.appendChild(E('button',{'type':'button','class':'uf-text-button','click':function(){self.resetFilters();}},t('清除筛选','Clear filters')));
		}
		this.refs.resultCount.textContent=filtered.length+t(' 条记录',' records');
		this.refs.pageInfo.textContent=filtered.length?(start+1)+'–'+Math.min(start+this.state.size,filtered.length)+' / '+filtered.length:'0 / 0';this.refs.pageNumber.textContent=this.state.page+' / '+pages;this.refs.prev.disabled=this.state.page<=1;this.refs.next.disabled=this.state.page>=pages;
		this.refs.exportButton.disabled=!filtered.length&&!this.selected.size;
		this.refs.selection.replaceChildren();this.refs.selection.hidden=!this.selected.size;
		if(this.selected.size)this.refs.selection.appendChild(E('div',{},[node('span','',t('已选择 ','Selected ')+this.selected.size+t(' 台设备',' devices')),E('button',{'type':'button','class':'uf-text-button','click':function(){self.selected.clear();self.paint();}},t('清除选择','Clear selection'))]));
		if(focusLabel){var target=Array.from(this.refs.table.querySelectorAll('[aria-label]')).find(function(e){var r=e.closest('tr[data-client-id]');return e.getAttribute('aria-label')===focusLabel&&(r?r.getAttribute('data-client-id'):null)===focusRow;});if(target)target.focus({preventScroll:true});}
	},
	cell:function(r,key){
		if(key==='name')return E('button',{'type':'button','class':'uf-client-name','title':name(r)+' · '+(r.mac||r.id),'aria-label':t('查看 ','View ')+name(r)+t(' 详情',' details'),'click':L.bind(function(){this.detail(r,true);},this)},[brands.avatar(r.identity,false,(r.identity.name||deviceType(r.identity.type))+' · '+identitySource(r.identity)),node('strong','',name(r))]);
		if(key==='vendor')return E('span',{'class':'uf-client-vendor','title':r.identity.name?identitySource(r.identity):r.localMac?t('本地管理地址','Locally administered'):t('未匹配厂商','No vendor match')},[r.identity.name||t('未知','Unknown')]);
		if(key==='status')return node('span','uf-client-status '+r.status,status(r));
		if(key==='connection')return E('span',{'class':'uf-client-connection'},[icons.create(r.associated?'wifi':'connection'),node('span','',r.associated?(r.ssid||'Wi-Fi'):(r.device||t('未知','Unknown')))]);
		if(key==='signal'){if(r.signal==null)return node('span','uf-muted','—');var bars=node('span','uf-client-signal');for(var i=0;i<4;i++)bars.appendChild(E('i',{'class':r.signal>[-90,-80,-70,-60][i]?'lit':''}));return E('span',{'class':'uf-client-signal-value'},[bars,r.signal+' dBm']);}
		return node('span',key==='ip'||key==='mac'||key==='ipv6'?'uf-mono':'',this.value(r,key));
	},
	value:function(r,key){
		if(key==='name')return name(r);if(key==='vendor')return r.identity&&r.identity.name||t('未知','Unknown');if(key==='status')return status(r);if(key==='connection')return r.associated?r.ssid||'Wi-Fi':r.device||'—';
		if(key==='ip')return r.ipv4[0]||'—';if(key==='ipv6')return r.ipv6.join(', ')||'—';if(key==='mac')return r.mac||'—';if(key==='networks')return r.networks.join(', ')||'—';
		if(key==='signal')return r.signal==null?'—':r.signal+' dBm';if(key==='rxRate'||key==='txRate')return rate(r[key]);if(key==='inactive')return ago(r.inactive);
		if(key==='assignment')return r.reserved?t('静态租约','Reserved'):r.lease?'DHCP':t('未确定','Undetermined');return '—';
	},
	resetFilters:function(){
		this.state.search='';this.state.connection='all';this.state.network='';this.state.group='all';this.state.page=1;this.refs.search.value='';this.refs.connection.value='all';this.refs.network.value='';
		Object.keys(this.refs.groups).forEach(L.bind(function(g){this.refs.groups[g].button.classList.toggle('active',g==='all');this.refs.groups[g].button.setAttribute('aria-pressed',String(g==='all'));},this));this.paint();
	},
	detail:function(r,focus){
		if(focus)this.returnFocus=document.activeElement;this.refs.columnDetails.open=false;this.currentId=r.id;this.refs.drawer.hidden=false;this.refs.drawerName.textContent=name(r);this.refs.drawerContent.replaceChildren();
		var intro=node('div','uf-client-detail-identity');intro.appendChild(brands.avatar(r.identity,true,(r.identity.name||deviceType(r.identity.type))+' · '+identitySource(r.identity)));intro.appendChild(node('span','uf-client-status '+r.status,status(r)));this.refs.drawerContent.appendChild(intro);
		var self=this;
		function section(title,fields){var box=node('section','uf-client-detail-section');box.appendChild(node('h3','',title));fields.forEach(function(f){box.appendChild(E('div',{'class':'uf-client-detail-pair'},[node('span','',f[0]),node('span','',f[1]==null?'—':String(f[1]))]));});self.refs.drawerContent.appendChild(box);}
		section(t('设备识别','Device identification'),[[t('厂商','Vendor'),r.identity.name||t('未知','Unknown')],[t('识别依据','Identified by'),identitySource(r.identity)],[t('设备类型','Device type'),deviceType(r.identity.type)]]);
		section(t('连接信息','Connection'),[[t('最后确认在线','Last confirmed online'),r.lastSeen?new Date(r.lastSeen*1000).toLocaleString():'—'],[t('网络','Network'),this.value(r,'networks')],[t('连接','Connection'),this.value(r,'connection')],[t('接口','Interface'),r.device||'—'],[t('地址分配','Assignment'),this.value(r,'assignment')]]);
		section(t('网络地址','Addresses'),[['MAC',r.mac||'—'],['IPv4',r.ipv4.join(', ')||'—'],['IPv6',r.ipv6.join(', ')||'—'],[t('本地管理 MAC','Locally administered MAC'),r.mac?(r.localMac?t('是','Yes'):t('否','No')):'—']]);
		if(r.associated)section(t('无线链路','Wi-Fi link'),[['SSID',r.ssid||'—'],[t('信号','Signal'),this.value(r,'signal')],[t('信道','Channel'),r.channel||'—'],[t('接收链路速率','RX link rate'),rate(r.rxRate)],[t('发送链路速率','TX link rate'),rate(r.txRate)],[t('最近活动','Last activity'),ago(r.inactive)]]);
		section(t('记录来源','Record sources'),[[t('来源','Sources'),r.sources.map(sourceName).join(' · ')],[t('剩余租期','Lease remaining'),r.expires===-1?t('无限期','Unlimited'):r.expires==null?'—':r.expires>0?core.uptime(r.expires):t('已过期','Expired')]]);
		if(focus)this.refs.close.focus();
	},
	closeDetail:function(){
		if(!this.refs.drawer||this.refs.drawer.hidden)return;this.currentId=null;this.refs.drawer.hidden=true;if(this.returnFocus&&document.contains(this.returnFocus))this.returnFocus.focus();else this.refs.search.focus();
	},
	exportCSV:function(){
		var self=this,cols=this.activeColumns(),rows=this.selected.size?this.rows.filter(function(r){return self.selected.has(r.id);}):this.filtered;
		var blob=new Blob([model.csv(cols.map(function(c){return c.title;}),rows.map(function(r){return cols.map(function(c){return self.value(r,c.key);});}))],{type:'text/csv;charset=utf-8'});
		var url=URL.createObjectURL(blob),link=E('a',{'href':url,'download':'openwrt-clients-'+new Date().toISOString().slice(0,10)+'.csv'});document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
	}
});
