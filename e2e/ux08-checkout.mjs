// MUTATES SAMPLE ORDERS. Run only on the isolated UX08 server at localhost:3082 (see handoff).
import assert from 'node:assert/strict';

export default async function (page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the isolated UX08 fixture server');
  await page.goto('/pos');
  const countOrders = () => page.eval("fetch('/api/orders?scope=today', {headers:{'x-token': JSON.parse(localStorage.getItem('cactus.session')).token}}).then(r=>r.json()).then(x=>x.length)");
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
  await page.click('.cart .actions > button:first-child');
  await page.click('.topbar a[href="/kitchen"]');
  await page.click('.topbar a[href="/pos"]');
  assert.equal(await page.eval("document.querySelector('.cart .actions > button:first-child').disabled"), true);
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 1);
  await page.eval('window.ux08ReleaseReply()');
  await page.wait(250);
  await page.click('.cart .actions > button:first-child');
  assert.equal(await countOrders(), before + 1, 'Retry after navigation must return the committed order');
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
  assert.equal(order.paid, true); assert.equal(order.total, 400); assert.equal(order.payments, 1); assert.ok(order.receipt);
  await page.shot('sample-payment-complete');
  console.log('UX08: in-flight navigation, lost-reply deduplication, fresh-order identity and sample cash checkout passed.');
}
