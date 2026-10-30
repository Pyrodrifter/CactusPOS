import assert from 'node:assert/strict';
export default async function(page) {
  await page.login('1234');
  assert.equal(await page.eval('location.origin'),'http://localhost:3082');
  const call = (method,path,body,key) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)},
    headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''}${key ? `, 'idempotency-key': ${JSON.stringify(key)}` : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then(r=>r.json())`);
  const before=await call('GET','/reports/day'), base=before.report.drawer.expectedCents;
  const created=await call('POST','/orders',{lines:[{itemId:'cola',qty:2}]});
  const sale=await call('POST',`/orders/${created.id}/pay`,{method:'cash'});
  await page.goto('/admin');
  await page.click('.cash-in'); await page.type('.cash-amount','100.00'); await page.type('.cash-reason','Sunday opening float'); await page.click('.cash-save');
  assert.equal((await call('GET','/reports/day')).report.drawer.expectedCents,base+10600);
  // A committed cash-out with a lost reply must recover after reload without moving/recording cash twice.
  await page.eval(`(()=>{const original=fetch.bind(window);window.fetch=async(url,init)=>{const r=await original(url,init);if(url==='/api/cash/movements'&&init?.method==='POST'&&r.ok)throw new TypeError('fixture: cash reply lost');return r}})()`);
  await page.click('.cash-out'); await page.type('.cash-amount','10.00'); await page.type('.cash-reason','Wrong withdrawal entry'); await page.click('.cash-save');
  assert.ok(await page.eval("!!document.querySelector('.cash-pending')"));
  await page.goto('/admin'); await page.wait(300);
  assert.equal(await page.eval("!!document.querySelector('.cash-pending')"),false);
  const entries=await call('GET','/cash/movements');
  assert.equal(entries.filter(x=>x.reason==='Wrong withdrawal entry').length,1);
  assert.equal((await call('GET','/reports/day')).report.drawer.expectedCents,base+9600);
  await page.click('.cash-journal summary');
  await page.eval("[...document.querySelectorAll('.cash-journal li')].find(x=>x.textContent.includes('Wrong withdrawal entry')).querySelector('.cash-reverse').click()"); await page.wait(250);
  assert.equal(await page.eval("document.querySelector('.cash-amount').readOnly"),true);
  await page.type('.cash-reason','Wrong entry reversed'); await page.click('.cash-save');
  assert.equal((await call('GET','/reports/day')).report.drawer.expectedCents,base+10600);
  await page.click(`[data-order-id="${sale.id}"] .review-correct`);
  await page.click('.pos-correct-lines li:first-child .stepper button:first-child');
  await page.click('.pos-correct .pos-payment-method button:nth-child(2)');
  await page.click({text:'Wrong quantity'});
  await page.wait(2200);
  for(const [width,height] of [[1180,820],[390,844]]) {
    await page.size(width,height); const measured=await page.measure();
    assert.deepEqual(measured.overflowX,[],JSON.stringify(measured)); assert.deepEqual(measured.small,[],JSON.stringify(measured));
    await page.shot(`settlement-correct-${width}`);
  }
  await page.click('.pos-correct .actions .primary'); await page.wait(400);
  const reviewed=await call('GET','/reports/day');
  assert.equal(reviewed.report.drawer.expectedCents,base+10000);
  const old=await call('GET',`/orders/${sale.id}`);
  assert.equal(old.status,'void'); assert.ok(old.correctedBy);
  const replacement=await call('GET',`/orders/${old.correctedBy.orderId}`);
  assert.equal(replacement.totalCents,300); assert.equal(replacement.payments[0].method,'card');
  for(const [width,height] of [[1180,820],[390,844]]) {
    await page.size(width,height); await page.goto('/admin');
    const measured=await page.measure(); assert.deepEqual(measured.overflowX,[],JSON.stringify(measured)); assert.deepEqual(measured.small,[],JSON.stringify(measured));
    await page.shot(`settlement-report-${width}`);
  }
  await page.click('.cash-in'); const measured=await page.measure();
  assert.deepEqual(measured.overflowX,[],JSON.stringify(measured)); assert.deepEqual(measured.small,[],JSON.stringify(measured));
  await page.shot('settlement-cash-dialog-390'); await page.click('.admin-close');
  await page.click('.reports-close'); await page.type('.admin-dialog input[inputmode=decimal]',((base+10000)/100).toFixed(2));
  await page.click('.admin-dialog-actions .primary'); await page.wait(300);
  const closed=await call('GET','/reports/day'); assert.equal(closed.closed.cashDifferenceCents,0); assert.equal(closed.closed.cashCountBasis,'drawer'); assert.equal(closed.changedSinceClose,false);
  const history=(await call('GET','/reports/z')).length;
  await page.click('.reports-close');
  await call('POST','/cash/movements',{direction:'out',amountCents:100,reason:'Another device cash out'},'other-device-cash-1');
  await page.click('.admin-dialog-actions .primary'); await page.wait(300);
  assert.equal((await call('GET','/reports/z')).length,history,'Stale settlement must not allocate another Z number');
  assert.match(await page.eval("document.querySelector('.reports > .error')?.textContent??''"),/changed/);
  const html=await page.eval(`fetch('/api/reports/day/print.html?date=${closed.today}',{headers:{'x-token':JSON.parse(localStorage.getItem('cactus.session')).token}}).then(r=>r.text())`);
  assert.match(html,/Sunday opening float/);assert.match(html,/Counted \(whole drawer\)/);
  await page.eval("localStorage.setItem('cactus.lang','nl')"); await page.goto('/admin');
  assert.match(await page.eval("document.querySelector('.cash-drawer').textContent"),/Kas in/);
  await page.shot('settlement-report-nl-390');
  console.log('Settlement: cash in/out, lost reply recovery, reversal, admin sale correction, whole-drawer count, stale-close guard and EN/NL touch screens passed.');
}
