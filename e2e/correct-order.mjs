// Browser check for correcting a paid order (BOARD UX14).
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

  // A sale rung up wrong: two colas instead of one, and the juice was forgotten. Paid in cash; it was really card.
  const created = await call('POST', '/orders', { lines: [{ itemId: 'burger', qty: 1 }, { itemId: 'cola', qty: 2 }] });
  const original = await call('POST', `/orders/${created.id}/pay`, { method: 'cash', expectedTotalCents: 2000 });
  assert.equal(original.totalCents, 2000);

  await page.goto('/pos');
  await page.click('.pos-toolbar .tabs button:nth-child(3)');
  await page.click('.pos-orders-filter button:nth-child(2)'); // everything of today, not only what is still to pay
  const opened = await page.eval(`(() => { const row = [...document.querySelectorAll('.orders li')].find((li) => li.querySelector('.num').textContent.startsWith('#${original.ticketNumber}') && li.querySelector('.pos-correct-btn')); if (!row) return false; row.querySelector('.pos-correct-btn').click(); return true; })()`);
  assert.ok(opened, 'A paid order has a Correct button');
  await page.wait(300);
  assert.match(await text('#pos-correct-title'), new RegExp(`Correct order #${original.ticketNumber}`));
  assert.equal(await page.eval("document.querySelector('.pos-correct .actions .primary').disabled"), true, 'Nothing changed yet, nothing to save');

  await page.click('.pos-correct-lines li:nth-child(2) .stepper button:first-child'); // one cola, not two
  assert.match(await text('.pos-correct-money'), /Give \$3\.00 back from the drawer/);
  await page.type('.pos-correct input[type=search]', 'juice');
  await page.click('.pos-correct-found button');
  assert.match(await text('.pos-correct-money'), /Collect \$1\.50 more/);
  await page.click('.pos-correct .pos-payment-method button:nth-child(2)');
  assert.match(await text('.pos-correct-money'), /Payment method becomes card.*Verify actual cash and card transactions/);
  assert.match(await text('.pos-correct-sum'), /Was\$20\.00Becomes\$21\.50/);
  assert.equal(await page.eval("document.querySelector('.pos-correct .actions .primary').disabled"), true, 'A reason is required');
  await page.click({ text: 'Wrong item' });
  await page.shot('correct-order-1180');
  for (const [width, height] of [[390, 844], [1180, 820]]) {
    await page.size(width, height);
    await page.wait(250);
    const audit = await page.measure();
    assert.deepEqual(audit.overflowX, [], JSON.stringify(audit));
    assert.deepEqual(audit.small, [], JSON.stringify(audit));
    if (width === 390) await page.shot('correct-order-390');
  }

  await page.click('.pos-correct .actions .primary');
  await page.wait(900);
  assert.equal(await page.eval("!!document.querySelector('.pos-correct')"), false, 'The sheet closes when the correction is saved');
  const old = await call('GET', `/orders/${original.id}`);
  assert.equal(old.status, 'void');
  assert.equal(old.voidReason, 'Wrong item');
  const fixed = await call('GET', `/orders/${old.correctedBy.orderId}`);
  assert.deepEqual(fixed.lines.map((l) => [l.name, l.qty]), [['Burger', 1], ['Cola', 1], ['Fresh Juice', 1]]);
  assert.deepEqual([fixed.paid, fixed.totalCents, fixed.payments[0].method, fixed.ticketNumber, fixed.corrects.receiptNumber], [true, 2150, 'card', original.ticketNumber, original.receiptNumber]);
  assert.equal(fixed.receiptNumber, old.correctedBy.receiptNumber);
  // The list shows both, each saying what happened to it.
  const rows = await page.eval("[...document.querySelectorAll('.orders li')].map((li) => li.textContent)");
  assert.ok(rows.some((row) => row.includes(`Replaces receipt #${original.receiptNumber}`)), 'The corrected sale names the receipt it replaces');
  assert.ok(rows.some((row) => row.includes(`Corrected: receipt #${fixed.receiptNumber}`)), 'The original names the receipt that corrected it');
  const report = (await call('GET', '/reports/day')).report;
  assert.ok(report.corrections.count >= 1);
  assert.equal(report.refunds.length, 0, 'A correction is not a refund');
  console.log('Correct a paid order: quantity down, item added, cash to card, reason, saved as a linked replacement; both receipts labelled; passed.');
}
