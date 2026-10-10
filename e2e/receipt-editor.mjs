// Browser check for personal receipts (BOARD UX12, UX13): lettering, printer looks, dividers, QR codes, publishing.
// MUTATES SAMPLE DATA (publishes a receipt design, places an order). Run through `npm run e2e`.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  const call = (method, path, body) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)},
    headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then((r) => (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text())`);
  const preview = () => page.eval("document.querySelector('.re-paper-stage iframe').srcdoc");
  const choose = (selector, value) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const settle = () => page.wait(700); // the preview follows a moment after each change

  await page.goto('/admin');
  await page.click({ text: 'Receipt design' });
  await settle();
  assert.match(await preview(), /<div class="t center b lg">Cactus Blue<\/div>/, 'The untouched design prints the name as it always did');

  /* The business name as lettering in a font of this device. */
  await page.click({ text: 'Lettering' });
  const fonts = await page.eval("[...document.querySelectorAll('.re-font small')].map((e) => e.textContent)");
  assert.ok(fonts.length >= 5, `fonts offered: ${fonts.join(', ')}`);
  assert.ok(fonts.includes('Handwriting'), 'The generic families are always offered');
  await page.eval("document.querySelectorAll('.re-font')[0].click()");
  await settle();
  const withName = await preview();
  assert.match(withName, /<svg role="img" aria-label="Cactus Blue" viewBox="0 0 \d+ \d+"/, 'The name is a picture now');
  assert.ok(!/<div class="t center b lg">Cactus Blue<\/div>/.test(withName), 'and no longer printer text');
  const first = await page.eval("document.querySelector('.re-paper-stage iframe').srcdoc.length");
  await page.click({ text: 'XL' });
  await settle();
  assert.notEqual(await page.eval("document.querySelector('.re-paper-stage iframe').srcdoc.length"), first, 'A bigger size draws a different picture');
  console.log(`fonts on this device: ${fonts.length} (${fonts.slice(0, 6).join(', ')}…)`);

  /* Two lines of my own: wide printer letters above the items, lettering below the total. */
  await page.click({ text: 'Add a line' });
  await page.type('.re-message textarea', 'Fresh from the grill');
  await choose('.re-message .re-style select', 'wide');
  await choose('.re-message .re-message-tools select', 'top');
  await page.click({ text: 'Add a line' });
  await page.type('.re-message:nth-of-type(2) textarea', 'Hasta luego');
  await page.eval("[...document.querySelectorAll('.re-message:nth-of-type(2) .re-seg button')].find((b) => b.textContent === 'Lettering').click()");
  await page.click({ text: 'Waves' });
  await choose('.re-card .two select', 'huge');
  await settle();
  const html = await preview();
  assert.match(html, /<div class="t center wide">Fresh from the grill<\/div>/);
  assert.match(html, /aria-label="Hasta luego"/);
  assert.match(html, /class="deco"/);
  assert.match(html, /<div class="t center b huge">ORDER #42<\/div>/);
  assert.ok(html.indexOf('Fresh from the grill') < html.indexOf('House burger') && html.indexOf('Hasta luego') > html.indexOf('TOTAL'), 'Lines sit where they were put');

  /* QR codes: WiFi for guests and a link to the website. */
  await page.click({ text: 'Add a WiFi code' });
  await page.type('.re-code input', 'Cactus Guest');
  await page.type('.re-code label:nth-of-type(3) input', 'burgers4ever');
  await page.click({ text: 'Add a link code' });
  await page.type('.re-code:nth-of-type(2) input', 'https://www.cactusblue.us');
  await settle();
  const coded = await preview();
  assert.match(coded, /aria-label="QR WIFI:T:WPA;S:Cactus Guest;P:burgers4ever;;" viewBox="0 0 \d+ \d+"/, 'The WiFi code is drawn in the preview');
  assert.match(coded, /<br>Free WiFi<\/div>\s*<div class="t center b">WiFi: Cactus Guest<\/div>\s*<div class="t center">Password: burgers4ever<\/div>/);
  assert.match(coded, /aria-label="QR https:\/\/www\.cactusblue\.us"/);
  await page.shot('receipt-editor-1180');

  /* The editor fits a tablet and a phone, in both of its phone views. */
  for (const [width, height] of [[1180, 820], [390, 844]]) {
    await page.size(width, height);
    await page.wait(250);
    const audit = await page.measure();
    assert.deepEqual(audit.overflowX, [], JSON.stringify(audit));
    assert.deepEqual(audit.small, [], JSON.stringify(audit));
  }
  await page.shot('receipt-editor-390');
  await page.click({ text: 'Preview' });
  await page.wait(300);
  await page.shot('receipt-preview-390');
  await page.size(1180, 820);

  /* Publishing keeps it, and a real receipt uses it. */
  await page.click('.re-publish');
  await page.wait(900);
  const state = await call('GET', '/admin/receipt-templates');
  assert.equal(state.current.version, 1);
  assert.equal(state.current.template.receipt.nameArt.text, 'Cactus Blue');
  assert.equal(state.current.template.receipt.messages.length, 2);
  assert.deepEqual(state.current.template.receipt.codes.map((code) => code.kind), ['wifi', 'link']);
  const order = await call('POST', '/orders', { lines: [{ itemId: 'cola', qty: 1 }] });
  assert.equal(order.templateVersion, 1);
  await call('POST', `/orders/${order.id}/pay`, { method: 'cash', expectedTotalCents: order.totalCents });
  const receipt = await call('GET', `/orders/${order.id}/receipt`);
  assert.match(receipt, /aria-label="Cactus Blue"/);
  assert.match(receipt, /Fresh from the grill/);
  assert.match(receipt, /aria-label="Hasta luego"/);
  assert.match(receipt, /aria-label="QR WIFI:T:WPA;S:Cactus Guest;P:burgers4ever;;"/, 'A real receipt carries the WiFi code');
  await page.goto('/admin');
  await page.click({ text: 'Receipt design' });
  await settle();
  assert.match(await page.eval("document.querySelector('.re-eyebrow').textContent"), /Version 1\s+Published/);
  assert.equal(await page.eval("document.querySelectorAll('.re-message:not(.re-code)').length"), 2);
  assert.equal(await page.eval("document.querySelectorAll('.re-code').length"), 2);
  console.log('Receipt editor: lettering for the name and a line, printer looks, divider, huge number, WiFi and link codes, publish and a real receipt passed.');
}
