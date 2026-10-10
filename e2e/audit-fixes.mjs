// Browser checks for the fixes from the 2026-10-10 app audit (BOARD A03, A06, T27).
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
  const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);

  /* A03: the pay sheet shows $14.00, another screen adds a round, the cashier confirms by card. */
  const tab = await call('POST', '/orders', { lines: [{ itemId: 'burger', qty: 1 }], tabName: 'Audit tab' });
  await page.goto('/pos');
  await page.click('.pos-toolbar .tabs button:nth-child(2)');
  await page.click({ text: 'Audit tab' });
  await page.click('.tab-sheet-pay');
  assert.equal(await text('.pos-payment-total'), '$14.00');
  await call('POST', `/orders/${tab.id}/lines`, { lines: [{ itemId: 'juice', qty: 2 }] });
  await page.click('.pos-payment-method button:nth-child(2)');
  await page.click('.pos-payment .actions .primary');
  await page.wait(600);
  assert.match(await text('.pos-payment .error'), /order changed.*\$23\.00/i, 'The cashier is told the order changed');
  assert.equal(await text('.pos-payment-total'), '$23.00', 'The sheet now shows the real total');
  assert.equal((await call('GET', `/orders/${tab.id}`)).paid, false, 'Nothing was recorded for the old amount');
  await page.shot('audit-pay-changed');
  await page.click('.pos-payment .actions .primary');
  await page.wait(800);
  assert.ok(await page.eval("!!document.querySelector('.pos-paid-confirmation')"), 'Confirming the new amount pays the order');
  const paid = await call('GET', `/orders/${tab.id}`);
  assert.equal(paid.payments[0].amountCents, 2300);
  assert.equal(paid.payments[0].method, 'card');
  await page.click('.pos-paid .actions .primary');

  /* A06: the sample till still has the example PINs, and Admin says so until Staff is opened. */
  await page.goto('/admin');
  assert.match(await text('.admin-pin-reminder'), /example PIN.*Owner, Staff/);
  await page.click('.admin-pin-reminder button');
  assert.equal(await text('.admin-tabs button[aria-current="page"]'), 'Staff');
  assert.equal(await page.eval("!!document.querySelector('.admin-pin-reminder')"), false);

  /* T27: the Backups page makes a checked backup on request and fits a tablet and a phone. */
  await page.click({ text: 'Backups' });
  await page.wait(500);
  const rows = () => page.eval("document.querySelectorAll('.admin .reports-rows li').length");
  const before = await rows();
  await page.click({ text: 'Back up now' });
  await page.wait(1200);
  assert.match(await text('.admin .reports-status'), /Last backup .*order/);
  assert.equal(await rows(), before + 1, 'The new backup is listed');
  const state = await call('GET', '/admin/backups');
  assert.equal(state.last.orders, (await call('GET', '/orders?scope=today')).length, 'The backup holds every order');
  assert.equal(state.problem, null);
  for (const [width, height] of [[1180, 820], [390, 844]]) {
    await page.size(width, height);
    await page.wait(200);
    const audit = await page.measure();
    assert.deepEqual(audit.overflowX, [], JSON.stringify(audit));
    assert.deepEqual(audit.small, [], JSON.stringify(audit));
    await page.shot(`audit-backups-${width}`);
  }
  console.log('Audit fixes: changed total refused then paid, example-PIN reminder, backup made and listed, Backups page fits.');
}
