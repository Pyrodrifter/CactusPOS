// Browser check for the one-tap kitchen and the kitchen lock (BOARD UX17).
// MUTATES SAMPLE ORDERS. Run through `npm run e2e`, which starts the throwaway till at localhost:3082.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  const call = (method, path, body) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)},
    headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then((r) => r.json())`);
  const status = async (o) => (await call('GET', `/orders/${o.id}`)).status;
  const has = (selector) => page.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
  const path = () => page.eval('location.pathname');
  await page.eval("localStorage.setItem('cactus.display.kitchenLock', 'false'), localStorage.setItem('cactus.display.kitchenFlow', 'quick')");
  await page.size(1180, 820);

  /* One tap: a ticket goes straight to Ready and shrinks to its number; a tap on the number is picked up; Undo. */
  const order = await call('POST', '/orders', { lines: [{ itemId: 'burger', qty: 1 }], tabName: 'Flow check' });
  await page.goto('/kitchen');
  await page.wait(700);
  assert.equal(await has('.kcols'), false, 'The one-tap kitchen has no columns per status');
  await page.click(`article[aria-label$=" ${order.ticketNumber}"]`);
  await page.wait(900);
  assert.equal(await status(order), 'ready', 'One tap on the ticket marks it ready');
  const chip = `.kitchen-ready-chip[aria-label*="Ticket ${order.ticketNumber},"]`;
  assert.ok(await has(chip), 'The ready order shows as a number in the Ready strip');
  assert.equal(await has(`article[aria-label$=" ${order.ticketNumber}"]`), false, 'and no longer as a ticket');
  await page.shot('kitchen-flow-quick');
  await page.click(chip);
  await page.wait(900);
  assert.equal(await status(order), 'collected', 'A tap on the number marks it picked up');
  await page.click('.kitchen-undo');
  await page.wait(900);
  assert.equal(await status(order), 'ready', 'Undo brings it back');

  /* The lock: switched on in Screen tools, the device keeps to the kitchen and loses the top bar. */
  await page.click('.screen-tools-button');
  await page.wait(300);
  assert.ok(await page.eval("document.querySelector('.screen-tools-scroll > .kitchen-settings') === document.querySelector('.screen-tools-scroll').firstElementChild"), 'On the kitchen its settings come first');
  await page.click('.kitchen-settings [role=switch]');
  await page.wait(300);
  await page.click('.screen-tools-done');
  await page.wait(300);
  assert.equal(await has('.topbar'), false, 'Locked: no top bar with Order and Admin');
  for (const elsewhere of ['/pos', '/admin', '/login']) {
    await page.goto(elsewhere);
    await page.wait(300);
    assert.equal(await path(), '/kitchen', `Locked: ${elsewhere} leads back to the kitchen`);
  }
  for (const [w, h] of [[1180, 820], [1024, 700], [820, 1180], [390, 844]]) {
    await page.size(w, h);
    await page.wait(250);
    const m = await page.measure();
    assert.deepEqual([m.small, m.overflowX], [[], []], `Locked kitchen fits ${w}x${h}`);
  }
  await page.size(1180, 820);
  await page.shot('kitchen-flow-locked');
  await page.click('.kitchen-tools');
  await page.wait(300);
  assert.ok(await has('.screen-tools .kitchen-settings'), 'Screen tools opens from the locked kitchen');

  /* Three steps, chosen in the same place; then unlock. */
  await page.click('.kitchen-flow-picker button:nth-child(2)');
  await page.click('.kitchen-settings [role=switch]');
  await page.click('.screen-tools-done');
  await page.wait(300);
  assert.ok(await has('.topbar') && await has('.kcols'), 'Unlocked with the top bar back, three columns shown');
  const stepped = await call('POST', '/orders', { lines: [{ itemId: 'fries', qty: 1 }] });
  await page.wait(700);
  await page.click(`article[aria-label$=" ${stepped.ticketNumber}"]`);
  await page.wait(900);
  assert.equal(await status(stepped), 'preparing', 'In three steps the first tap starts the ticket');
  await page.goto('/pos');
  await page.wait(300);
  assert.equal(await path(), '/pos', 'Unlocked, the counter opens again');
  await page.eval("localStorage.setItem('cactus.display.kitchenFlow', 'quick')");
  console.log('Kitchen flow: one tap to ready, number tap to picked up, undo, lock keeps to the kitchen and fits, three steps and unlock; passed.');
}
