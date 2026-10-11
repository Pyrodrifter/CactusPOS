// Takes the pictures for the user manual (docs/manual/img). Run by `node scripts/make-manual.mjs --shots`, which
// starts a THROWAWAY till with the Cactus Blue menu for it. Never point this at a real till: it places sample
// orders, pays them and closes nothing, but they would be real sales there.
//
// MANUAL_LANG=en|nl chooses the language of the screens. The first run on a fresh till makes the sample orders;
// a second run (the other language) finds them and only takes pictures.
import assert from 'node:assert/strict';

const lang = process.env.MANUAL_LANG === 'nl' ? 'nl' : 'en';

export default async function (page) {
  const shot = (name) => page.shot(`${lang}-${name}`);
  const count = (selector) => page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const call = (method, path, body) => page.eval(`fetch(${JSON.stringify(`/api${path}`)}, {
    method: ${JSON.stringify(method)},
    headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token${body ? ", 'content-type': 'application/json'" : ''} },
    ${body ? `body: ${JSON.stringify(JSON.stringify(body))},` : ''}
  }).then((r) => r.json())`);
  /** Taps one menu item by its name; when it asks for options, picks the ones named and adds it. */
  const add = async (name, ...options) => {
    await page.eval(`(() => { const b = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.pos-item-name').textContent === ${JSON.stringify(name)}); b.click(); return true; })()`);
    await page.wait(250);
    if (!(await count('.pos-sheet [role=dialog]'))) return;
    for (const option of options) { await page.click({ text: option }); await page.wait(120); }
    await page.click('.pos-sheet .actions .primary');
    await page.wait(200);
  };

  /** Opens a screen. The "Install app" offer is hidden: the installed till window never shows it. */
  const go = async (path) => {
    await page.goto(path);
    await page.eval("(() => { document.head.insertAdjacentHTML('beforeend', '<style>.pwa-status{display:none!important}</style>'); return true; })()");
  };

  await page.size(1180, 820);
  // The manual is printed: light screens, in the reader's language.
  await page.goto('/login');
  assert.match(await page.eval('location.port || "80"'), /^30[5-9]\d$/, 'Use the throwaway till that make-manual starts (ports 3050-3099), never a real one');
  await page.eval(`(() => { localStorage.setItem('cactus.lang', ${JSON.stringify(lang)}); localStorage.setItem('cactus.display.theme', 'light'); return true; })()`);
  await go('/login');
  await page.wait(400);
  await shot('login');

  await page.login('1234');
  await go('/pos');
  await page.wait(500);
  const fresh = (await call('GET', '/orders?scope=today')).length === 0;

  // --- Taking an order
  await page.eval(`(() => { const b = [...document.querySelectorAll('.item')].find((x) => x.querySelector('.pos-item-name').textContent === 'Famous Kiteburger'); b.click(); return true; })()`);
  await page.wait(300);
  await page.click({ text: 'Extra cheese' });
  await page.wait(150);
  await shot('options');
  await page.click('.pos-sheet .actions .primary');
  await page.wait(200);
  await add('Chips', 'Doritos');
  await add('Soft Drink', 'Coke');
  await add('Soft Drink', 'Coke');
  await page.wait(300);
  await shot('order');

  // --- Paying in cash
  await page.click('.pos-pay');
  await page.wait(300);
  await page.eval("(() => { const b = [...document.querySelectorAll('.pos-quick button')].find((x) => x.textContent.includes('50')); b?.click(); return !!b; })()");
  await page.wait(200);
  await shot('pay-cash');
  await page.click('.pos-payment .actions .primary');
  await page.wait(900);
  assert.ok(await count('.pos-paid-confirmation'), 'The sample cash sale is paid');
  await shot('paid');
  await page.click('.pos-paid .actions .primary');
  await page.wait(300);

  // --- Paying by card (picture only)
  await add('Chicken Wrap');
  await page.click('.pos-pay');
  await page.wait(300);
  await page.click('.pos-payment-method button:nth-child(2)');
  await page.wait(200);
  await shot('pay-card');
  await page.click('.pos-payment .actions .ghost');
  await page.wait(200);

  // --- Pay later with a name: a tab
  await page.click('.pos-later-btn');
  await page.wait(300);
  await page.type('.pos-later input', 'Mike');
  await page.wait(150);
  await shot('pay-later');
  if (fresh) {
    await page.click('.pos-later .actions .primary');
    await page.wait(700);
    // More sample work for the kitchen, the pickup board and the day report.
    const one = await call('POST', '/orders', { lines: [{ itemId: 'classic_cheese', qty: 2, modifierOptionIds: [] }, { itemId: 'juice', qty: 2, modifierOptionIds: [] }] });
    await call('POST', `/orders/${one.id}/pay`, { method: 'card', expectedTotalCents: one.totalCents, tipCents: 200 });
    const two = await call('POST', '/orders', { lines: [{ itemId: 'veg_wrap', qty: 1, modifierOptionIds: ['no_tomato'] }, { itemId: 'water', qty: 1, modifierOptionIds: ['w_still'] }] });
    await call('POST', `/orders/${two.id}/pay`, { method: 'cash', expectedTotalCents: two.totalCents, tenderedCents: 2000 });
    const three = await call('POST', '/orders', { lines: [{ itemId: 'spicy_burger', qty: 1, modifierOptionIds: ['x_bacon'] }, { itemId: 'chips', qty: 1, modifierOptionIds: ['c_lays'] }, { itemId: 'soda', qty: 1, modifierOptionIds: ['d_sprite'] }] });
    assert.ok(one.id && two.id && three.id, `Sample orders were made: ${[one, two, three].map((o) => JSON.stringify(o).slice(0, 160)).join(' | ')}`);
    // One order of each kind for the kitchen picture: the first is ready, the second being prepared, the rest new.
    const today = (await call('GET', '/orders?scope=today')).sort((x, y) => x.ticketNumber - y.ticketNumber);
    await call('POST', `/orders/${today[0].id}/status`, { status: 'preparing' });
    await call('POST', `/orders/${today[0].id}/status`, { status: 'ready' });
    await call('POST', `/orders/${today[1].id}/status`, { status: 'preparing' });
  } else {
    await page.click('.pos-later .actions .ghost');
    await page.click('.pos-clear-order');
  }
  await go('/pos');
  await page.wait(500);
  await page.click('.pos-toolbar .tabs button:nth-child(2)');
  await page.wait(400);
  await shot('tabs');
  await page.click('.tab-card');
  await page.wait(400);
  await shot('tab');
  await go('/pos');
  await page.wait(400);
  await page.click('.pos-toolbar .tabs button:nth-child(3)');
  await page.wait(300);
  await page.click('.pos-orders-filter button:nth-child(2)');
  await page.wait(300);
  await shot('orders');

  // --- Kitchen and pickup board
  await go('/kitchen');
  await page.wait(600);
  await shot('kitchen');
  await go('/pickup');
  await page.wait(700);
  await shot('pickup');

  // --- Admin
  const tabs = ['reports', 'menu', 'receipts', 'business', 'staff', 'tax', 'printer', 'books', 'backups'];
  const admin = async (tab) => {
    await go('/admin');
    await page.wait(400);
    await page.click(`.admin-tabs button:nth-child(${tabs.indexOf(tab) + 1})`);
    await page.wait(700);
  };
  for (const tab of ['reports', 'menu', 'receipts', 'business', 'staff', 'tax', 'printer', 'backups']) {
    await admin(tab);
    await shot(`admin-${tab}`);
  }
  await admin('staff');
  await page.click('.admin-row-main');
  await page.wait(500);
  await shot('admin-staff-edit');
  await admin('reports');
  await page.click('.reports-close');
  await page.wait(500);
  await shot('close-day');

  // --- Screen tools (language, light or dark, sign out). Taller, so the whole list is in the picture.
  await page.size(1180, 1240);
  await go('/pos');
  await page.wait(400);
  await page.click('.screen-tools-button');
  await page.wait(400);
  await shot('screen-tools');
}
