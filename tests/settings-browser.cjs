const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.UNIFI_PREVIEW_URL||'http://127.0.0.1:8765';
const output=path.resolve(__dirname,'../artifacts/settings');fs.mkdirSync(output,{recursive:true});
const palette=require('../tests/fixtures/reference/unifi-dark-palette.json').measurements;
const rgb=key=>'rgb('+palette[key].hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'}),page=await context.newPage(),errors=[],checked=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/?page=clients');await page.locator('tbody tr[data-client-id]').first().waitFor();
  assert.equal(await page.getByRole('combobox',{name:'每页条数'}).inputValue(),'50');
  assert.equal(await page.locator('tbody tr[data-client-id]').count(),24);
  assert.equal(await page.evaluate(()=>timers[0].interval),10);
  await page.goto(base+'/?page=settings');await page.getByLabel('外观模式',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('仪表盘信息刷新间隔',{exact:true}).inputValue(),'1');
  await page.getByLabel('仪表盘信息刷新间隔',{exact:true}).selectOption('5');
  await page.getByLabel('外观模式',{exact:true}).selectOption('dark');
  await page.getByLabel('客户端每页条数',{exact:true}).selectOption('25');
  await page.getByLabel('客户端自动刷新间隔',{exact:true}).selectOption('30');
  await page.getByLabel('默认展开导航栏',{exact:true}).check();
  await page.getByLabel('启用客户端在线探测',{exact:true}).uncheck();
  await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'保存并应用',exact:true}).click()]);
  await page.getByLabel('外观模式',{exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-darkmode'),'true');
  assert.equal(await page.getByLabel('外观模式',{exact:true}).inputValue(),'dark');
  assert.equal(await page.getByLabel('仪表盘信息刷新间隔',{exact:true}).inputValue(),'5');
  assert.equal(await page.getByLabel('启用客户端在线探测',{exact:true}).isChecked(),false);
  await page.screenshot({path:path.join(output,'settings-dark.png'),fullPage:true});
  await page.goto(base+'/?page=clients');await page.locator('tbody tr[data-client-id]').first().waitFor();
  assert.equal(await page.getByRole('combobox',{name:'每页条数'}).inputValue(),'25');
  assert.equal(await page.evaluate(()=>timers[0].interval),30);
  assert.equal(await page.locator('.uf-nav-toggle').getAttribute('aria-expanded'),'true');
  const colors=await page.locator('.uf-devices-table td').first().evaluate(el=>{
   // Transparent tables show their containing surface; check the visible color.
   let surface=el;
   while(surface&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
   return {bg:surface?getComputedStyle(surface).backgroundColor:null,fg:getComputedStyle(el).color};
  });
  assert.equal(colors.bg,rgb('canvas'));assert.equal(colors.fg,rgb('secondary_text'));
  const sampledColors=await page.evaluate(()=>({header:getComputedStyle(document.querySelector('body>header')).backgroundColor,
    navigation:getComputedStyle(document.querySelector('.uf-navigation')).backgroundColor,
    border:getComputedStyle(document.querySelector('.uf-devices-table td')).borderBottomColor,
    input:getComputedStyle(document.querySelector('.uf-client-toolbar input')).backgroundColor,
    selection:getComputedStyle(document.querySelector('.uf-client-filter.active')).backgroundColor,
    accent:getComputedStyle(document.querySelector('.uf-client-filter.active')).color}));
  assert.equal(sampledColors.header,rgb('header'));assert.equal(sampledColors.navigation,rgb('canvas'));
  assert.equal(sampledColors.border,rgb('card_border'));assert.equal(sampledColors.input,'rgba(249, 250, 250, 0.04)');
  assert.equal(sampledColors.selection,rgb('selected_background'));assert.equal(sampledColors.accent,rgb('accent_blue'));
  await page.screenshot({path:path.join(output,'clients-dark.png'),fullPage:true});
  checked.push('defaults: 50 rows and 10s; settings persist; configured 25 rows, 30s and expanded navigation take effect');
  await page.goto(base+'/?page=overview&mode=dark&nav_expanded=0&activity_always=0');await page.locator('#uf-dashboard').waitFor();
  assert.equal(await page.evaluate(()=>modules['unifi.settings'].get('dashboard_refresh')),'5');
  await page.locator('.uf-chart-foot').filter({hasText:'示例历史数据'}).waitFor();
  assert.equal(await page.locator('.uf-grid-line').first().evaluate(el=>getComputedStyle(el).stroke),rgb('graph_grid'));
  await page.screenshot({path:path.join(output,'overview-dark.png'),fullPage:true});
  await page.goto(base+'/?page=components&mode=dark');await page.locator('#invalid').waitFor();
  assert.notEqual(await page.locator('#invalid').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 250, 250)');
  await page.getByRole('button',{name:'打开弹窗',exact:true}).click();
  assert.equal(await page.locator('.modal').evaluate(el=>getComputedStyle(el).backgroundColor),rgb('canvas'));
  await page.screenshot({path:path.join(output,'modal-dark.png'),fullPage:true});
  await page.goto(base+'/?page=clients&mode=auto&nav_expanded=0');await page.locator('tbody tr[data-client-id]').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('data-darkmode'),'false');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.getAttribute('data-darkmode')==='true');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.getAttribute('data-darkmode')==='false');
  await page.goto(base+'/?page=clients&mode=light');await page.emulateMedia({colorScheme:'dark'});
  assert.equal(await page.locator('html').getAttribute('data-darkmode'),'false');
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/?page=clients&mode=dark&nav_expanded=0');await page.locator('tbody tr[data-client-id]').first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,'clients-dark-mobile.png'),fullPage:true});
  checked.push('dashboard refresh defaults to 1s and persists a configured 5s interval; dark overview, clients, native controls, invalid input and modal; system changes live; forced light overrides system; mobile has no page overflow');
  checked.push('rendered canvas, header, borders, controls, selection, accent and graph grid match sampled PNG palette');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checked,colors,sampledColors,pageErrors:errors},null,2)+'\n');console.log('Settings browser checks passed:',checked.join('; '));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
