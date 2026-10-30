// Browser check for the kitchen with greasy fingers (BOARD UX16): a short tap moves a ticket on, a thumb resting
// on it or a finger smearing across it does not, and the Wipe button pauses touch.
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
  const quick = await call('POST', '/orders', { lines: [{ itemId: 'fries', qty: 1 }] });
  const rest = await call('POST', '/orders', { lines: [{ itemId: 'fries', qty: 1 }] });
  const smear = await call('POST', '/orders', { lines: [{ itemId: 'fries', qty: 1 }] });
  await page.size(1180, 820);
  await page.eval("localStorage.setItem('cactus.display.kitchenFlow', 'quick')"); // the default: one tap is Ready
  await page.goto('/kitchen');
  await page.wait(800);

  /* A press on the ticket's items, the way a finger does it: down, perhaps a slide, then the click on release. */
  const press = async (order, { holdMs = 60, slide = 0 } = {}) => {
    const lines = `document.querySelector('article[aria-label$=" ${order.ticketNumber}"] .ticket-lines')`;
    await page.eval(`(() => { const el = ${lines}; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
      window.__press = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: __press.x, clientY: __press.y, pointerType: 'touch', isPrimary: true })); })()`);
    if (slide) await page.eval(`${lines}.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: __press.x + ${slide}, clientY: __press.y, pointerType: 'touch', isPrimary: true }))`);
    await page.wait(holdMs);
    await page.eval(`${lines}.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: __press.x, clientY: __press.y }))`);
    await page.wait(900);
    return (await call('GET', `/orders/${order.id}`)).status;
  };
  assert.equal(await press(quick), 'ready', 'A short tap marks the ticket ready');
  assert.equal(await press(rest, { holdMs: 1200 }), 'sent', 'A thumb resting on the ticket does not move it');
  assert.equal(await press(smear, { slide: 40 }), 'sent', 'A finger sliding across the ticket does not move it');
  await page.shot('kitchen-taps');

  await page.click('.kitchen-wipe');
  await page.wait(300);
  assert.ok(await page.eval("!!document.querySelector('.clean-screen')"), 'Wipe screen opens the cleaning pause');
  assert.ok(await page.eval("document.querySelector('.shell-content').hasAttribute('inert')"), 'The board ignores touch while it is wiped');
  await page.shot('kitchen-wipe');
  console.log('Kitchen taps: short tap moves on, resting thumb and smear do not, Wipe screen pauses touch; passed.');
}
