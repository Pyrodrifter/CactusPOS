// MUTATES SAMPLE ORDERS. Run through `npm run e2e`, which starts the throwaway till at localhost:3082.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  await page.goto('/pos');
  const countOrders = () => page.eval("fetch('/api/orders?scope=today', {headers:{'x-token': JSON.parse(localStorage.getItem('cactus.session')).token}}).then(r=>r.json()).then(x=>x.length)");
  // "Pay later" opens a sheet for an optional tab name; its main button sends the order to the kitchen.
  const sendLater = async () => {
    if (await page.eval("!!document.querySelector('.draft-retry')")) {
      await page.click('.draft-retry'); await page.click('.draft-reviewed'); return;
    }
    await page.click('.cart .actions > .pos-later-btn');
    assert.equal(await page.eval("!!document.querySelector('.pos-later')"), true, 'Pay later sheet opens');
    await page.click('.pos-later .actions .primary');
  };
  const before = await countOrders();
  await page.type('.pos-search input', 'juice');
  await page.click('.item');
  // Commit the order, delay its reply across a screen change, then simulate a lost response.
  await page.eval(`(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (url === '/api/orders' && init?.method === 'POST' && !window.ux08LostReply) {
        window.ux08LostReply = true;
        const response = await original(url, init);
        if (!response.ok) return response;
        await new Promise(resolve => { window.ux08ReleaseReply = resolve; });
        throw new TypeError('UX08 fixture: lost response');
      }
      return original(url, init);
    };
  })()`);
  await sendLater();
  await page.click('.topbar a[href="/kitchen"]');
  await page.click('.topbar a[href="/pos"]');
  assert.equal(await page.eval("document.querySelector('.cart .actions > .pos-later-btn').disabled"), true, 'Sending stays locked while the first request is in flight');
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 1, 'Draft survives the screen change');
  await page.eval('window.ux08ReleaseReply()');
  await page.wait(250);
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 1, 'The cart is kept when the reply is lost');
  assert.match(await page.eval("document.querySelector('.cart .error')?.textContent ?? ''"), /Cannot reach the till/, 'A lost reply is explained in plain words');
  await sendLater();
  await page.wait(300);
  assert.equal(await countOrders(), before + 1, 'Retry after a lost reply must return the committed order');
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 0);

  // A fresh, identical order is a new sale. Confirm a sample cash payment through the UI.
  await page.type('.pos-search input', 'juice');
  await page.click('.item');
  await page.click('.pos-pay');
  await page.click('.pos-payment .actions .primary');
  await page.wait(800);
  assert.ok(await page.eval("!!document.querySelector('.pos-paid-confirmation')"));
  assert.equal(await countOrders(), before + 2);
  const order = await page.eval("fetch('/api/orders?scope=today', {headers:{'x-token': JSON.parse(localStorage.getItem('cactus.session')).token}}).then(r=>r.json()).then(x=>x.sort((a,b)=>b.ticketNumber-a.ticketNumber)[0]).then(x=>({paid:x.paid,total:x.totalCents,receipt:x.receiptNumber,payments:x.payments.length}))");
  assert.equal(order.paid, true); assert.equal(order.total, 450); assert.equal(order.payments, 1); assert.ok(order.receipt);
  await page.shot('sample-payment-complete');
  // The paid screen must let the cashier carry on (it once froze behind a hidden print dialog).
  await page.click('.pos-paid .actions .primary');
  assert.equal(await page.eval("!!document.querySelector('.pos-payment')"), false, 'Paid screen closes');
  console.log('UX08: in-flight navigation, lost-reply deduplication, fresh-order identity and sample cash checkout passed.');
}
