// Browser regression checks for manufacturer badges and flat form controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.UNIFI_PREVIEW_URL || 'http://127.0.0.1:8765';
const output = path.resolve(__dirname, '../artifacts/client-ui');
fs.mkdirSync(output, {recursive: true});
const appearance = el => {
  const c = getComputedStyle(el), before = getComputedStyle(el, '::before');
  return {shadow: c.boxShadow, transition: c.transitionDuration, border: c.borderColor,
    outline: c.outlineStyle, beforeShadow: before.boxShadow, beforeTransition: before.transitionDuration,
    beforeBorder: before.borderColor, beforeContent:before.content};
};

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
  const errors = [], checked = [], controls = [], density = [];
  async function measureDensity(page, width) {
    const sizes = await page.evaluate(() => {
      const heights = selector => Array.from(document.querySelectorAll(selector), el => el.getBoundingClientRect().height);
      return {rows: heights('.uf-devices-table tbody tr'), headers: heights('.uf-devices-table thead tr'),
        filters: heights('.uf-client-filter'), avatars: heights('.uf-devices-table .uf-client-avatar')};
    });
    for (const height of [...sizes.rows, ...sizes.headers]) assert.equal(height, 32, 'table row at ' + width);
    for (const height of sizes.filters) assert.equal(height, 28, 'filter row at ' + width);
    for (const height of sizes.avatars) assert.equal(height, 24, 'avatar fits compact row at ' + width);
    assert.ok(sizes.rows.length && sizes.filters.length);
    density.push({width, ...sizes});
  }
  async function open(name, width = 1440) {
    const page = await browser.newPage({viewport: {width, height: 1000}});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(baseURL + '/?page=' + name);
    await page.locator('#topmenu .uf-nav-toggle').waitFor();
    return page;
  }
  async function flat(locator, key, pseudo = false) {
    await locator.focus();
    const state = await locator.evaluate(appearance);
    assert.equal(state.shadow, 'none', key);
    if (pseudo) {
      assert.equal(state.beforeShadow, 'none', key + '::before');
      assert.equal(state.beforeContent,'none',key + ' removes the legacy checkbox/radio painting');
    }
    assert.ok(!state.border.includes('82, 168, 236'), key + ' has no legacy blue border');
    controls.push({key, state});
  }
  try {
    const clients = await open('clients');
    await clients.locator('.uf-devices-table tbody tr').first().waitFor();
    await measureDensity(clients, 1440);
    const nameSort = clients.getByRole('button', {name: '按名称排序', exact: true});
    await nameSort.click();
    assert.equal(await nameSort.locator('..').getAttribute('aria-sort'), 'descending');
    assert.equal(await nameSort.locator('svg.uf-icon-sort-down').count(), 1);
    await nameSort.click();
    assert.equal(await nameSort.locator('..').getAttribute('aria-sort'), 'ascending');
    assert.equal(await nameSort.locator('svg.uf-icon-sort-up').count(), 1);
    await clients.getByLabel('每页条数', {exact: true}).selectOption('10');
    assert.equal(await clients.locator('tr[data-client-id]').count(), 10);
    const firstPageClient = await clients.locator('tr[data-client-id]').first().getAttribute('data-client-id');
    assert.equal(await clients.getByRole('button', {name: '上一页', exact: true}).isDisabled(), true);
    await clients.getByRole('button', {name: '下一页', exact: true}).click();
    assert.notEqual(await clients.locator('tr[data-client-id]').first().getAttribute('data-client-id'), firstPageClient);
    await clients.getByRole('button', {name: '上一页', exact: true}).click();
    assert.equal(await clients.locator('tr[data-client-id]').first().getAttribute('data-client-id'), firstPageClient);
    await clients.getByLabel('每页条数', {exact: true}).selectOption('50');
    checked.push('SVG sort indicators follow ascending/descending state; labeled next/previous buttons change pages and retain disabled state');
    assert.ok(await clients.locator('.uf-brand-avatar[data-brand=apple] svg path').count());
    const search = clients.getByRole('searchbox', {name: '搜索客户端'});
    await search.fill('Apple');
    assert.ok(await clients.locator('tbody tr[data-client-id]').count() >= 3);
    for (const cell of await clients.locator('tbody .uf-client-col-vendor').all()) {
      assert.equal(await cell.textContent(), 'Apple');
      assert.equal(await cell.locator('.uf-client-vendor').getAttribute('title'), '主机名推测');
    }
    await clients.getByRole('button', {name: '查看 Apple TV 详情', exact: true}).click();
    assert.match(await clients.locator('.uf-client-drawer-content').textContent(), /设备识别.*Apple.*主机名推测/);
    await clients.getByRole('button', {name: '关闭设备详情'}).click();

    const downloading = clients.waitForEvent('download');
    await clients.getByRole('button', {name: '导出 CSV', exact: true}).click();
    await (await downloading).saveAs(path.join(output, 'clients-vendors.csv'));
    const csv = fs.readFileSync(path.join(output, 'clients-vendors.csv'), 'utf8');
    assert.ok(csv.includes('厂商') && csv.includes('Apple'));
    await search.fill('F2:11:22:33:44:17');
    assert.equal(await clients.locator('tbody .uf-client-col-vendor').textContent(), '未知');
    assert.equal(await clients.locator('tbody .uf-client-vendor').getAttribute('title'), '本地管理地址');
    assert.equal(await clients.locator('tbody .uf-brand-avatar').count(), 0);

    await clients.evaluate(() => {
      const view = modules['unifi.clients'];
      view.accept(Object.assign({}, view.data, {hints: Object.assign({}, view.data.hints,
        {'00:1B:63:12:34:56': {name: 'Studio Device', ipaddrs: ['10.0.0.210']}})}));
    });
    await search.fill('Studio Device');
    assert.equal(await clients.locator('tbody .uf-client-col-vendor').textContent(), 'Apple, Inc.');
    assert.equal(await clients.locator('tbody .uf-client-vendor').getAttribute('title'), 'MAC 前缀匹配');
    await clients.evaluate(() => {
      const view = modules['unifi.clients'];
      view.accept(Object.assign({}, view.data, {hints: Object.assign({}, view.data.hints, {
        'BC:24:11:12:34:56': {name: 'Virtual Guest', ipaddrs: ['10.0.0.211']},
        '52:54:00:12:34:56': {name: 'Virtual Machine', ipaddrs: ['10.0.0.212']},
        '00:D8:61:12:34:56': {name: 'Desktop Device', ipaddrs: ['10.0.0.214']},
        '60:BE:B4:12:34:56': {name: 'Registry Device', ipaddrs: ['10.0.0.213']}
      })}));
    });
    for (const [vendor, source] of [['Proxmox Server Solutions GmbH', 'MAC 前缀匹配'], ['QEMU', '虚拟网卡前缀匹配'], ['Micro-Star INTL CO., LTD.', 'MAC 前缀匹配'], ['S-Bluetech co., limited', 'MAC 前缀匹配']]) {
      await search.fill(vendor);
      assert.equal(await clients.locator('tbody .uf-client-col-vendor').textContent(), vendor);
      assert.equal(await clients.locator('tbody .uf-client-vendor').getAttribute('title'), source);
      if (vendor !== 'S-Bluetech co., limited') {
        assert.ok(await clients.locator('tbody .uf-brand-avatar svg path').count(), vendor + ' uses its SVG logo');
        assert.equal(await clients.locator('tbody .uf-brand-avatar b').count(), 0, vendor + ' has no letter placeholder');
      }
      await clients.locator('tbody .uf-client-name').click();
      assert.ok((await clients.locator('.uf-client-drawer-content').textContent()).includes(vendor));
      await clients.getByRole('button', {name: '关闭设备详情'}).click();
    }
    checked.push('Proxmox, QEMU and MSI render SVG logos; organizations without a brand icon appear in vendor search and details');
    await search.fill('');
    await flat(clients.locator('tbody input[type=checkbox]').first(), 'client row checkbox', true);
    await clients.locator('tbody input[type=checkbox]').first().check();
    assert.ok(await clients.locator('tr.uf-client-selected').count());
    await clients.getByText('自定义列', {exact: true}).click();
    const column = clients.locator('.uf-client-column-options input[aria-label="显示列：IPv6 地址"]');
    await flat(column, 'column checkbox', true);
    await column.check();
    assert.equal(await column.isChecked(), true);
    for (const height of await clients.locator('.uf-client-column-options label').evaluateAll(els => els.map(el => el.getBoundingClientRect().height)))
      assert.equal(height, 28, 'column option row');
    await clients.locator('.uf-client-column-options').screenshot({path: path.join(output, 'columns-focused.png')});
    await clients.getByRole('button', {name: '完成', exact: true}).click();
    await clients.locator('.uf-client-title').click();
    await clients.screenshot({path: path.join(output, 'clients-desktop.png'), fullPage: true});
    checked.push('brand SVGs, hostname and OUI sources, unknown private MAC, vendor search, details, CSV and column checkboxes');
    await clients.close();

    for (const width of [1440, 1000, 390]) {
      const page = await open('clients', width);
      await page.locator('.uf-brand-avatar').first().waitFor();
      await measureDensity(page, width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({path: path.join(output, width === 1440 ? 'clients-desktop.png' : 'clients-' + width + '.png'), fullPage: true});
      await page.getByRole('button', {name: 'IP 表', exact: true}).click();
      await measureDensity(page, width);
      await page.close();
    }
    checked.push('client main and IP layouts at 1440px, 1000px and 390px without page overflow');
    checked.push('rendered table rows and headers 32px, filter and column rows 28px, badges 24px');

    const interfaces = await open('interfaces');
    await flat(interfaces.locator('#protocol'), 'native select');
    await flat(interfaces.locator('#autostart'), 'native checkbox', true);
    await interfaces.locator('#maincontent [data-edit]').first().click();
    await flat(interfaces.locator('#modal-name'), 'modal input');
    await interfaces.close();

    const components = await open('components');
    await flat(components.locator('#radio-off'), 'native radio', true);
    await flat(components.locator('#invalid'), 'invalid input');
    assert.equal(await components.locator('#invalid').evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(240, 56, 59)');
    // Exercise the exact legacy selectors used by LuCI's custom dropdowns.
    await components.evaluate(() => {
      document.querySelector('#view').appendChild(E('div', {}, [
        E('input', {id: 'input-button', type: 'button', value: 'Input button'}),
        E('input', {id: 'input-submit', type: 'submit', value: 'Input submit'}),
        E('div', {id: 'custom-select', class: 'cbi-select focus', tabindex: 0}, 'Select'),
        E('div', {id: 'custom-dropdown', class: 'cbi-dropdown', open: '', tabindex: 0},
          E('ul', {class: 'dropdown'}, E('li', {class: 'focus', selected: ''}, 'Option')))
      ]));
    });
    for (const id of ['input-button', 'input-submit', 'custom-select', 'custom-dropdown'])
      await flat(components.locator('#' + id), id);
    assert.equal(await components.locator('#custom-dropdown li').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(33, 35, 39, 0.07)');
    await components.close();
    checked.push('flat native inputs, radio and checkbox pseudos, custom dropdown focus/open, input buttons and preserved validation');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({checked, controls, density, pageErrors: errors}, null, 2) + '\n');
    console.log('Client UI browser checks passed:', checked.join('; '));
  } finally {
    await browser.close();
  }
})().catch(e => {console.error(e); process.exitCode = 1;});
