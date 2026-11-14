/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
'require view';
'require form';

var zh=/^zh/.test(document.documentElement.lang||navigator.language);
function t(cn,en){return zh?cn:en;}
return view.extend({
	render:function(){
		var m=new form.Map('unifi',t('Unifi 主题设置','Unifi Theme Settings'));
		var s=m.section(form.NamedSection,'theme','theme');s.addremove=false;
		var mode=s.option(form.ListValue,'mode',t('外观模式','Appearance'));
		mode.value('auto',t('跟随系统','System'));mode.value('light',t('浅色','Light'));mode.value('dark',t('深色','Dark'));mode.default='auto';mode.rmempty=false;
		var size=s.option(form.ListValue,'page_size',t('客户端每页条数','Clients per page'));
		[10,25,50,100].forEach(function(n){size.value(String(n),String(n));});size.default='50';size.rmempty=false;
		var refresh=s.option(form.ListValue,'client_refresh',t('客户端自动刷新间隔','Client refresh interval'));
		[5,10,30,60].forEach(function(n){refresh.value(String(n),n+t(' 秒',' seconds'));});refresh.default='10';refresh.rmempty=false;
		var dashboard=s.option(form.ListValue,'dashboard_refresh',t('仪表盘信息刷新间隔','Dashboard information refresh interval'),t('控制系统信息、接口状态和 DHCP 租约的刷新频率。网络活动每秒更新。','Refresh system information, interface status and DHCP leases at this interval. Network activity updates every second.'));
		[1,2,5,10,30,60].forEach(function(n){dashboard.value(String(n),n+t(' 秒',' seconds'));});dashboard.default='1';dashboard.rmempty=false;
		var expanded=s.option(form.Flag,'nav_expanded',t('默认展开导航栏','Expand navigation by default'));expanded.default='0';expanded.rmempty=false;
		var activity=s.option(form.Flag,'activity_always',t('总是采样网络活动','Always sample network activity'),t('每秒在后台采集，保留最近 1 小时的记录；关闭网页后继续，路由器或采集服务重启后清空。','Collect every second in the background and keep the last hour, including while the web interface is closed. Router or collector restarts clear the history.'));activity.default='1';activity.rmempty=false;
		var presence=s.option(form.Flag,'presence_enabled',t('启用客户端在线探测','Enable client presence detection'),t('在后台观察客户端活动并按需发送 ARP 请求；关闭后状态显示为 —。','Observe client activity and send ARP requests as needed. Status is unavailable when disabled.'));presence.default='1';presence.rmempty=false;
		var reload=function(){window.location.reload();};document.addEventListener('uci-applied',reload,{once:true});
		window.addEventListener('pagehide',function(){document.removeEventListener('uci-applied',reload);},{once:true});
		return m.render();
	}
});
