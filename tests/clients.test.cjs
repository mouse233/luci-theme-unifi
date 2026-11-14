const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'../htdocs/luci-static/resources');
const model=new Function('baseclass',fs.readFileSync(path.join(base,'unifi/client-model.js'),'utf8'))({extend:x=>x});
const A='02:11:22:33:44:01',B='80:11:22:33:44:02',C='84:11:22:33:44:03';
const arp='IP address HW type Flags HW address Mask Device\n';
test('same client is merged across hints, v4/v6 leases, reservation and Wi-Fi',()=>{
 const rows=model.merge({hints:{[A.toLowerCase()]:{name:'hint name',ipaddrs:['10.0.0.2'],ip6addrs:['fd00::2']}},leases:{dhcp_leases:[{macaddr:A,ipaddr:'10.0.0.2',hostname:'lease name',expires:300}],dhcp6_leases:[{macaddr:A,ip6addrs:['fd00::2']}]},statics:[{mac:[A],name:'User alias',ip:'10.0.0.2'}],wifi:[{mac:A,signal:-54,device:'phy0-ap0',ssid:'Home',networks:['lan'],rx:{rate:866700},tx:{rate:433300},inactive:0}],arp:arp+'10.0.0.2 0x1 0x2 '+A+' * br-lan',deviceNetworks:{'br-lan':'lan'}});
 assert.equal(rows.length,1);const r=rows[0];assert.equal(r.name,'User alias');assert.equal(r.status,'unknown');assert.equal(r.localMac,true);assert.deepEqual(r.ipv4,['10.0.0.2']);assert.deepEqual(r.ipv6,['fd00::2']);assert.deepEqual(r.networks,['lan']);assert.equal(r.rxRate,866700);assert.equal(r.inactive,0);assert.deepEqual(new Set(r.sources),new Set(['hint','lease','static','neighbor','wifi']));
});
test('ARP only accepts complete unicast entries and ignores zero/broadcast/incomplete neighbors',()=>{
 const text=arp+'10.0.0.2 0x1 0x2 '+A+' * br-lan\n10.0.0.3 0x1 0x0 '+B+' * br-lan\n10.0.0.4 0x1 0x2 00:00:00:00:00:00 * br-lan\n10.0.0.5 0x1 0x2 FF:FF:FF:FF:FF:FF * br-lan';
 assert.equal(model.parseARP(text).length,1);
 assert.equal(model.merge({arp:text})[0].status,'unknown');
});
test('expired lease and saved reservation are never classified as an online association',()=>{
 const rows=model.merge({leases:{dhcp_leases:[{macaddr:A,expires:0},{macaddr:B,expires:-1}]},statics:[{mac:C,name:'Server',ip:'10.0.0.8'}]});
 assert.equal(rows.find(x=>x.mac===A).status,'unknown');assert.equal(rows.find(x=>x.mac===B).status,'unknown');assert.equal(rows.find(x=>x.mac===C).status,'unknown');assert.ok(rows.every(x=>!x.associated));
});
test('upstream gateway and router-owned MACs are excluded without dropping a LAN client',()=>{
 const rows=model.merge({hints:{[A]:{name:'Gateway'},[B]:{name:'Router'},[C]:{name:'Client'}},ignoreMacs:[B,'not-a-mac'],wanDevices:['eth0'],arp:arp+'192.0.2.1 0x1 0x2 '+A+' * eth0\n10.0.0.3 0x1 0x2 '+C+' * br-lan'});
 assert.deepEqual(rows.map(x=>x.mac),[C]);
});
test('IPv6 DUID-only leases survive invalid MAC hints and unknown fields stay unavailable',()=>{
 const rows=model.merge({ignoreMacs:['bad'],leases:{dhcp6_leases:[{duid:'duid-test',ip6addrs:['fd00::3'],expires:200}]}});
 assert.equal(rows.length,1);assert.equal(rows[0].mac,null);assert.equal(rows[0].id,'duid:duid-test');assert.equal(rows[0].signal,null);assert.equal(rows[0].rxRate,null);assert.equal(rows[0].status,'unknown');
});
test('filter combinations and IPv4 sorting use data rather than lexical IP ordering',()=>{
 const rows=model.merge({hints:{[A]:{name:'Phone',ipaddrs:['10.0.0.10']},[B]:{name:'Laptop',ipaddrs:['10.0.0.2']}},wifi:[{mac:A,signal:-70,networks:['guest']}]});
 assert.deepEqual(model.query(rows,{sort:'ip'}).map(x=>x.mac),[B,A]);assert.deepEqual(model.query(rows,{sort:'ip',direction:'desc'}).map(x=>x.mac),[A,B]);assert.equal(model.query(rows,{connection:'wifi',network:'guest',search:'phone'}).length,1);assert.equal(model.query(rows,{group:'static'}).length,0);assert.equal(model.query(rows,{search:A.toLowerCase()}).length,1);
});
test('CSV escapes quotes, commas, line breaks and spreadsheet formulas',()=>{
 const csv=model.csv(['Name','IP'],[['=HYPERLINK("bad")','10.0.0.2'],['x,y\nz','@formula']]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"x,y\nz"'));assert.ok(csv.includes('"\'@formula"'));
});
test('client production view has only read requests, and route uses its own ACL',()=>{
 const code=fs.readFileSync(path.join(base,'unifi/clients.js'),'utf8');assert.equal(/innerHTML|Math\.random|fixture|uci\.set|uci\.save|fs\.exec|fs\.write|set_inform|del_client/.test(code),false);
 const menu=JSON.parse(fs.readFileSync(path.resolve(base,'../../../root/usr/share/luci/menu.d/luci-theme-unifi.json'),'utf8'));
 assert.equal(menu['admin/unifi-clients'].action.path,'unifi/clients');assert.deepEqual(menu['admin/unifi-clients'].depends.acl,['luci-theme-unifi-clients']);
});
test('lease summary deduplicates DHCP records without inventing online status',()=>{
 assert.equal(model.leaseRows(null),null);
 const rows=model.leaseRows({dhcp_leases:[{macaddr:A,hostname:'<script>',ipaddr:'10.0.0.2'}],dhcp6_leases:[{macaddr:A.toLowerCase(),ip6addrs:['::2']},{duid:'cc',ip6addrs:['::3']}]});
 assert.equal(rows.length,2);assert.equal(rows[0].name,'<script>');assert.equal(rows[0].ip,'10.0.0.2');assert.equal(rows[1].ip,'::3');assert.equal(rows[0].associated,undefined);
});

test('presence uses validated service states and leaves missing or invalid evidence unknown',()=>{
 const rows=model.merge({hints:{[A]:{},[B]:{},[C]:{}},presence:{[A]:{status:'online',last_seen:1000},[B]:{status:'offline'},[C]:{status:'neighbor'}}});
 assert.equal(rows.find(r=>r.mac===A).status,'online'); assert.equal(rows.find(r=>r.mac===A).lastSeen,1000);
 assert.equal(rows.find(r=>r.mac===B).status,'offline'); assert.equal(rows.find(r=>r.mac===C).status,'unknown');
});
