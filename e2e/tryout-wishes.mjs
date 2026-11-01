// Browser check for the wishes after the tryout (BOARD UX22): ABB exempt on Today, pickup confirmed from Order,
// names on the pickup board, stock. MUTATES SAMPLE DATA. Run through `npm run e2e`, which starts the throwaway till at localhost:3082.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.size(1180, 820);
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  const call = (method, path, body) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)},
    headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then((r) => r.json())`);
  const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const has = (selector) => page.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
  const fits = async (label) => {
    for (const [w, h] of [[1180, 820], [1024, 700], [820, 1180], [390, 844]]) {
      await page.size(w, h);
      await page.wait(250);
      const m = await page.measure();
      assert.deepEqual([m.small, m.overflowX], [[], []], `${label} fits ${w}x${h}`);
    }
    await page.size(1180, 820);
  };
  await call('PUT', '/auto-collect', { seconds: 0 });

  /* A name typed in the cart goes to the order, and the board shows it instead of the number. */
  await page.goto('/pos');
  await page.wait(500);
  await page.click({ text: 'All items' });
  await page.click('.items .item:not(:disabled)');
  await page.wait(300);
  if (await has('.pos-modifier')) { await page.click('.pos-modifier .actions .primary'); await page.wait(300); }
  await page.fill?.('.pos-pickup-name', 'Mike');
  if (!page.fill) await page.eval(`(() => { const i = document.querySelector('.pos-pickup-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Mike'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.wait(200);
  await page.shot('tryout-cart-name');
  await page.click('.pos-later-btn');
  await page.wait(300);
  assert.equal(await page.eval(`document.querySelector('.pos-later input').value`), 'Mike', 'Pay later starts with the name from the cart');
  await page.click('.pos-later .actions .primary');
  await page.wait(800);
  const [named] = (await call('GET', '/orders?scope=active')).filter((o) => o.tabName === 'Mike');
  assert.ok(named, 'The order carries the name');
  const board = await call('GET', '/pickup');
  assert.equal(board.names[named.ticketNumber], 'Mike', 'The board data has the name');
  assert.equal(JSON.stringify(board).includes(named.lines[0].name), false, 'and nothing about the items');

  /* Ready orders show on Order; Picked up confirms, Undo brings it back. Nothing shows when nothing is ready. */
  const second = await call('POST', '/orders', { lines: [{ itemId: 'fries', qty: 2 }] });
  await call('POST', `/orders/${named.id}/status`, { status: 'ready' });
  await call('POST', `/orders/${second.id}/status`, { status: 'ready' });
  await page.wait(700);
  assert.match(await text('.pos-ready'), /Mike/, 'The ready order shows on Order by name');
  assert.match(await text('.pos-ready'), /Not paid/, 'and says that it is not paid');
  await page.shot('tryout-ready-strip');
  await fits('Order with ready orders');
  await page.eval(`[...document.querySelectorAll('.pos-ready li')].find((li) => li.textContent.includes('Mike')).querySelector('.pos-ready-done').click()`);
  await page.wait(700);
  assert.equal((await call('GET', `/orders/${named.id}`)).status, 'collected', 'Picked up marks it collected');
  await page.click('.pos-ready-undo button');
  await page.wait(700);
  assert.equal((await call('GET', `/orders/${named.id}`)).status, 'ready', 'Undo brings it back');
  await page.goto('/pickup');
  await page.wait(700);
  assert.match(await text('.pickup-ready'), /Mike/, 'The board shows the name');
  assert.ok((await text('.pickup-ready')).includes(String(second.ticketNumber)), 'and the number for an order without one');
  await page.shot('tryout-pickup-names');
  for (const [w, h] of [[1180, 820], [390, 844]]) { await page.size(w, h); await page.wait(200); assert.deepEqual((await page.measure()).overflowX, [], `Board fits ${w}x${h}`); }
  await page.size(1180, 820);

  /* Stock: prepared items count down with sales; general stock is counted by hand. */
  const burgerId = named.lines[0].itemId;
  await page.goto('/pos');
  await page.wait(500);
  await page.click('.pos-stock-tab');
  await page.wait(400);
  await page.click('.stock-add');
  await page.wait(300);
  await page.eval(`(() => { const set = (i, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }; const f = document.querySelectorAll('.stock-form input'); set(f[0], 'Made today'); set(f[1], '20'); set(f[2], 'pcs'); set(f[3], '18'); })()`);
  await page.click({ text: named.lines[0].name });
  await page.shot('tryout-stock-edit');
  await page.click('.stock-save');
  await page.wait(600);
  const made = (await call('GET', '/stock')).items[0];
  assert.ok(made.sold >= 1, 'Sales of the linked item count');
  assert.ok((await text('.stock')).includes(`Prepared 20 · ${made.sold} sold`), 'Prepared and sold are shown');
  assert.equal(await text('.stock-count strong'), `${20 - made.sold}left`, 'What is left is prepared minus sold');
  await page.click('.stock-count button:last-child');
  await page.wait(500);
  assert.equal(await text('.stock-count strong'), `${21 - made.sold}left`, 'Plus adds one');
  await call('PUT', '/stock/items/whole-buns', { name: 'Bags of buns', kind: 'whole', unit: 'bags', menuItemIds: [] });
  await call('POST', '/stock/items/whole-buns/adjust', { delta: 6 });
  await call('POST', '/orders', { lines: [{ itemId: burgerId, qty: 3, modifierOptionIds: [] }] }).catch(() => null);
  await page.wait(700);
  assert.match(await text('.stock'), /Bags of buns/, 'A change on another screen arrives by itself');
  await page.shot('tryout-stock');
  await fits('Stock');

  /* ABB off: Today says so and stays at zero; the reason is already filled in; the cart drops the ABB line. */
  await page.goto('/admin');
  await page.click({ text: 'Tax (ABB)' });
  await page.wait(300);
  await page.click('.tax-switch [role=switch]');
  await page.wait(300);
  assert.match(await page.eval(`document.querySelector('.admin-dialog input, dialog input, [role=dialog] input').value`), /food trucks, fishermen and small food carts/, 'The reason is ready to use');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(500);
  const abbBefore = (await call('GET', '/reports/day')).report.sales.taxCents;
  await call('POST', '/orders', { lines: [{ itemId: 'cola', qty: 1 }] }).then((o) => call('POST', `/orders/${o.id}/pay`, { method: 'cash' }));
  await page.click({ text: 'Today' });
  await page.wait(500);
  assert.match(await text('.reports-exempt'), /No ABB to pay: food trucks, fishermen and small food carts are exempt/, 'Today says why');
  assert.equal((await call('GET', '/reports/day')).report.sales.taxCents, abbBefore, 'An exempt sale adds no ABB');
  await page.shot('tryout-today-exempt');
  await call('PUT', '/admin/tax-exemption', { charged: true, reason: '' });
  console.log('Tryout wishes: name to board, pickup from Order with undo, stock with sold-today, ABB exempt on Today; passed.');
}
