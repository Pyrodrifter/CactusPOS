// Practice isolation, cart restoration and uncertain create/pay replies on the disposable e2e till only.
import assert from 'node:assert/strict';
export default async function(page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082');
  const call = (method, path, body) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)}, headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then(r=>r.json())`);
  await page.goto('/pos');
  const addJuice = async () => {
    if (await page.eval("!!document.querySelector('.pos-search-toggle') && !document.querySelector('.pos-search-toggle').getAttribute('aria-expanded').includes('true')")) await page.click('.pos-search-toggle');
    await page.type('.pos-search input','juice'); await page.click('.item');
  };
  await addJuice();
  await page.goto('/pos');
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 1);
  assert.ok(await page.eval("!!document.querySelector('.draft-restored')"));
  await page.shot('sunday-cart-restored');
  const initial = (await call('GET','/orders?scope=today')).length;
  await page.eval(`(() => { const original=fetch.bind(window); window.fetch=(url,init)=>url==='/api/orders'&&init?.method==='POST'?Promise.reject(new TypeError('fixture: offline before send')):original(url,init); })()`);
  await page.click('.pos-later-btn'); await page.click('.pos-later .actions .primary');
  await page.goto('/pos');
  assert.equal((await call('GET','/orders?scope=today')).length,initial);
  assert.ok(await page.eval("!!document.querySelector('.draft-retry')"));
  await page.click('.draft-retry'); await page.click('.draft-reviewed');
  const before = initial + 1;
  assert.equal((await call('GET','/orders?scope=today')).length,before);
  await addJuice();
  await page.eval(`(() => { const original=fetch.bind(window); window.fetch=async(url,init)=>{const r=await original(url,init);if(url==='/api/orders'&&init?.method==='POST'&&r.ok){throw new TypeError('fixture: reply lost after commit')}return r}; })()`);
  await page.click('.pos-later-btn'); await page.click('.pos-later .actions .primary');
  await page.goto('/pos');
  assert.equal((await call('GET','/orders?scope=today')).length,before+1);
  assert.equal(await page.eval("document.querySelectorAll('.cart li').length"),0);
  assert.ok(await page.eval("!!document.querySelector('.draft-recovery')"));
  await page.click('.draft-reviewed');
  await addJuice();
  await page.eval(`(() => { const original=fetch.bind(window); window.fetch=async(url,init)=>{const r=await original(url,init);if(String(url).endsWith('/pay')&&init?.method==='POST'&&r.ok){throw new TypeError('fixture: paid reply lost')}return r}; })()`);
  await page.click('.pos-pay'); await page.click('.pos-payment .actions .primary');
  await page.goto('/pos');
  assert.match(await page.eval("document.querySelector('.draft-recovery')?.textContent ?? ''"),/Already paid/);
  await page.shot('sunday-paid-recovery');
  assert.equal(await page.eval("!!document.querySelector('.draft-resume-pay')"),false);
  const liveOrders = await call('GET','/orders?scope=today');
  assert.equal(liveOrders.length,before+2);
  assert.equal(liveOrders.sort((a,b)=>b.ticketNumber-a.ticketNumber)[0].payments.length,1);
  await page.click('.draft-reviewed');
  await page.goto('/admin'); await page.click({text:'Ready to open'});
  assert.match(await page.eval("document.querySelector('.opening-check').textContent"),/The till server is responding/);
  for(const [width,height] of [[1180,820],[390,844]]) {
    await page.size(width,height); const measured=await page.measure();
    assert.deepEqual(measured.overflowX,[],JSON.stringify(measured)); assert.deepEqual(measured.small,[],JSON.stringify(measured));
    await page.shot(`sunday-opening-${width}`);
  }
  await page.click('.practice-control .screen-option');
  await page.click('.practice-start');
  await page.wait(700);
  assert.equal(await page.eval('location.pathname'),'/practice/pos');
  assert.ok(await page.eval("!!document.querySelector('.practice-banner')"));
  await addJuice(); await page.click('.pos-pay'); await page.click('.pos-payment .actions .primary');
  assert.ok(await page.eval("!!document.querySelector('.pos-paid-confirmation')"));
  assert.match(await page.eval("document.querySelector('.pos-paid .practice-sheet-label').textContent"),/PRACTICE/);
  const sample = await page.eval("fetch('/api/practice/orders?scope=today',{headers:{'x-token':JSON.parse(localStorage.getItem('cactus.practice.session')).token}}).then(r=>r.json())");
  assert.equal(sample.length,1);assert.equal(sample[0].receiptNumber,1);assert.equal(sample[0].paid,true);
  const html = await page.eval(`fetch('/api/practice/orders/${sample[0].id}/receipt',{headers:{'x-token':JSON.parse(localStorage.getItem('cactus.practice.session')).token}}).then(r=>r.text())`);
  assert.match(html,/PRACTICE \/ OEFENEN/);
  await page.shot('sunday-practice-paid');
  await page.click('.pos-paid .actions .primary');
  await page.click('.topbar a[href="/practice/kitchen"]');
  assert.equal(await page.eval('location.pathname'),'/practice/kitchen');
  await page.shot('sunday-practice-kitchen');
  assert.equal((await call('GET','/orders?scope=today')).length,before+2);
  await page.goto('/pos');
  assert.equal(await page.eval("!!document.querySelector('.practice-banner')"),false);
  console.log('Sunday readiness: cart reload, lost send/pay replies, opening checks and isolated practice sale/boards passed.');
}
