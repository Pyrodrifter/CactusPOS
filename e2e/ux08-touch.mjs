// Run through scripts/shot.mjs against a separate sample database. Does not submit orders or payments.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.login('1234');
  for (const [width, height] of [[1180, 820], [1024, 700], [820, 1180], [390, 844]]) {
    await page.size(width, height);
    await page.goto('/pos');
    const nav = await page.eval(`(() => {
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      const nav = document.querySelector('.topbar nav').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      return { top: bar.top, navBottom: nav.bottom, mainTop: main.top, mainWidth: main.width };
    })()`);
    assert.equal(nav.top, 0);
    assert.ok(nav.navBottom <= nav.mainTop);
    assert.equal(nav.mainWidth, width);
    const audit = await page.measure();
    assert.deepEqual(audit.overflowX, [], JSON.stringify(audit));
    // Skip link is offscreen until keyboard focused.
    assert.deepEqual(audit.small, [], JSON.stringify(audit));
    await page.shot(`counter-${width}`);

    await page.eval("document.querySelector('.screen-tools-button').focus()");
    await page.click('.screen-tools-button');
    assert.equal(await page.eval("document.querySelector('.shell-content').inert"), true);
    const toolAudit = await page.measure();
    assert.deepEqual(toolAudit.overflowX, [], JSON.stringify(toolAudit));
    await page.shot(`tools-${width}`);
    await page.click('.screen-tools-done');
    assert.equal(await page.eval("document.activeElement.className"), 'screen-tools-button');

    if (width <= 860) await page.click('.pos-search-toggle');
    await page.type('.pos-search input', 'juice');
    assert.ok(await page.eval("[...document.querySelectorAll('.item')].every(x => /juice/i.test(x.textContent)) && document.querySelectorAll('.item').length > 0"));
    await page.click('.item');
    assert.equal(await page.eval("document.querySelector('.cart .qty > span').textContent"), '1');
    await page.click('.pos-clear-order');
    assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 0);
    await page.click('.pos-undo button');
    assert.equal(await page.eval("document.querySelector('.cart .qty > span').textContent"), '1');
    await page.click('.qty button:first-child');
    assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 0);
    await page.click('.pos-undo button');
    assert.equal(await page.eval("document.querySelectorAll('.cart li').length"), 1);
    await page.click('.pos-search button');
    await page.type('.pos-search input', 'zzzznoitem');
    assert.equal(await page.eval("document.querySelectorAll('.item').length"), 0);
    assert.equal(await page.eval("!!document.querySelector('.pos-no-results')"), true);
    await page.click('.pos-no-results button');
    await page.click('.topbar a[href="/kitchen"]');
    await page.click('.topbar a[href="/pos"]');
    assert.equal(await page.eval("document.querySelector('.cart .qty > span').textContent"), '1', 'Draft must survive changing screens');

    // Phone cart bar and payment action remain in the viewport and hit-testable.
    const pay = width <= 860 ? '.pos-mobile-bar > .primary' : '.pos-pay';
    assert.equal(await page.eval(`(() => {
      const e = document.querySelector(${JSON.stringify(pay)}); const r = e.getBoundingClientRect();
      return r.bottom <= innerHeight && r.top >= 0 && [[.2,.2],[.8,.2],[.5,.5],[.2,.8],[.8,.8]].every(([x,y]) => e.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)));
    })()`), true, `Pay obscured at ${width}`);
    await page.click(pay);
    await page.shot(`payment-${width}`);
    const confirm = await page.eval(`(() => {
      const e = document.querySelector('.pos-payment .actions .primary'); e.scrollIntoView({block:'nearest'});
      const r = e.getBoundingClientRect();
      return r.height >= 48 && r.width >= 48 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
    })()`);
    assert.ok(confirm, `Payment confirm unreachable at ${width}`);
    await page.click('.pos-payment .actions .ghost');
    await page.click('.pos-clear-order'); // Each viewport starts with its own cart; reload now restores drafts.
  }
  await page.size(1180, 820);
  await page.goto('/pos');
  await page.click('.screen-tools-button');
  await page.click('.screen-option[role=switch]');
  await page.click('.screen-tools-done');
  await page.goto('/pos');
  assert.equal(await page.eval("document.querySelector('.shell').classList.contains('sunlight')"), true);
  await page.click('.screen-tools-button');
  await page.click('.screen-option[role=switch]');
  await page.click({ text: 'Nederlands' });
  assert.equal(await page.eval("document.querySelector('.sheet-head h2').textContent"), 'Schermopties');
  await page.click({ text: 'English' });
  await page.click({ text: 'Clean the screen' });
  assert.equal(await page.eval("document.querySelector('.shell-content').inert"), true);
  await page.shot('clean-screen');
  await page.eval("document.querySelector('.clean-resume').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await page.wait(600);
  await page.eval("document.querySelector('.clean-resume').dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))");
  assert.equal(await page.eval("!!document.querySelector('.clean-screen')"), true, 'A short tap must not unlock');
  await page.eval("document.querySelector('.clean-resume').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await page.wait(2200);
  assert.equal(await page.eval("!!document.querySelector('.clean-screen')"), false);
  assert.equal(await page.eval("document.querySelector('.shell-content').inert"), false);
  assert.equal(await page.eval("document.activeElement.className"), 'screen-tools-button');
  await page.goto('/kitchen'); await page.shot('kitchen');
  await page.goto('/admin'); await page.shot('admin');
  await page.goto('/pickup');
  assert.equal(await page.eval("!!document.querySelector('.shell')"), false);
  await page.shot('pickup');
  // Actual staff sign-in with keypad; wrong PIN feedback, clear-all, and valid sign-in.
  await page.eval("localStorage.removeItem('cactus.session')");
  await page.goto('/login');
  for (const digit of ['9', '9', '9', '9']) await page.click({ text: digit });
  await page.click('.login-submit');
  assert.ok(await page.eval("!!document.querySelector('.login .error')"));
  await page.click({ text: '1' }); await page.click('.pin-clear');
  assert.equal(await page.eval("document.querySelectorAll('.pin-dots .filled').length"), 0);
  for (const [width, height] of [[1180, 820], [1024, 700], [820, 1180], [390, 844]]) {
    await page.size(width, height); await page.wait(100); await page.shot(`login-${width}`);
    const audit = await page.measure();
    assert.deepEqual(audit.overflowX, [], JSON.stringify(audit));
    assert.deepEqual(audit.small, [], JSON.stringify(audit));
  }
  for (const digit of ['1', '2', '3', '4']) await page.click({ text: digit });
  await page.click('.login-submit');
  assert.equal(await page.eval('location.pathname'), '/pos');
  console.log('UX08: navigation, touch sizes, search, undo, payment reachability, preferences, clean lock and PIN flow passed.');
}
