// Browser check for the Tax tab and allergy marks on a menu item (TAX01, UX21).
// MUTATES THE SAMPLE MENU AND TAX SETUP. Run through `npm run e2e`, which starts the throwaway till at localhost:3082.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.size(1180, 820);
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const menu = () => page.eval(`fetch('/api/menu', { headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token } }).then((r) => r.json())`);

  /* The check shows what a $10.00 price holds and warns about unverified categories. */
  await page.goto('/admin');
  await page.click({ text: 'Tax (ABB)' });
  const check = await text('.tax-check');
  assert.match(check, /\$10\.00 on the menu = \$9\.43 \+ \$0\.57 ABB \(6%\)/, 'Worked example for 6%');
  assert.match(check, /not verified/, 'Unverified categories in use are flagged');
  assert.match(await text('.admin-body .orders'), /menu items?/, 'Each category says how many items use it');
  await page.shot('tax-tab');
  console.log(await page.measure());

  /* A new category from the Bonaire presets. */
  await page.click({ text: 'New tax category' });
  await page.click({ text: 'Insurance 7%' });
  await page.shot('tax-new-category');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(400);
  const ins = (await menu()).taxCategories.find((c) => c.id === 'insurance_7');
  assert.deepEqual(ins?.rates.map((r) => r.bps), [700], 'Saved with its 7% rate');
  assert.equal(ins.unverified, true, 'A new category starts unverified');

  /* Exempt needs a legal ground. */
  await page.click({ text: 'New tax category' });
  await page.click({ text: 'Exempt' });
  await page.type('.admin-dialog input[list=tax-grounds]', '');
  await page.click('.admin-dialog-actions .primary');
  assert.match(await text('.admin-dialog-foot .error'), /legal ground/, 'Refused without a ground');
  await page.click('.admin-dialog-actions .ghost');

  /* The menu creator has one price, the one the customer pays, and no ABB fields. Allergy marks save with the item. */
  await page.click({ text: 'Menu' });
  await page.click('[aria-label="Edit: Burger"]');
  assert.equal(await page.eval(`document.querySelector('.admin-dialog input[inputmode=decimal]').value`), '14.00');
  assert.doesNotMatch(await text('.admin-dialog'), /ABB|Tax/, 'No tax in the menu creator');
  await page.type('.admin-dialog input[inputmode=decimal]', '15.90');
  await page.click({ text: 'Gluten' });
  await page.shot('menu-item-allergies');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(400);
  const burger = (await menu()).items.find((i) => i.id === 'burger');
  assert.equal(burger.priceCents, 1590);
  assert.deepEqual(burger.tags, ['gluten'], 'The allergy mark is saved');

  /* A category colour chosen in the menu is saved and reaches the till. */
  await page.click('.menu-colors button:nth-of-type(4)');
  await page.wait(500);
  const colored = (await menu()).categories.find((c) => c.color);
  assert.equal(colored?.color, '#3f9a3a', 'The chosen colour is saved');
  await page.goto('/pos');
  await page.wait(700);
  assert.equal(await page.eval(`document.querySelector('.pos .cats button[style*="--c: #3f9a3a"], .pos .item[style*="--c: #3f9a3a"]') !== null`), true, 'The till uses the chosen colour');
  await page.goto('/admin');
  await page.wait(400);

  /* Switching ABB off for the whole business needs a reason; sales then carry no ABB; switching back restores it. */
  await page.click({ text: 'Tax (ABB)' });
  await page.click({ text: 'Charge ABB' });
  await page.eval(`(() => { const i = document.querySelector('.admin-dialog input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.click('.admin-dialog-actions .primary');
  assert.match(await text('.admin-dialog-foot .error'), /legal ground/, 'Refused without a reason');
  await page.type('.admin-dialog input', 'Food truck arrangement');
  await page.shot('tax-abb-off-dialog');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(400);
  assert.match(await text('.tax-switch'), /Off: every new sale is recorded as exempt \(Food truck arrangement\)/);
  assert.match(await text('.tax-check'), /no sale gets ABB/);
  assert.ok((await menu()).taxCategories.every((c) => c.kind === 'exempt'), 'The counter sees only exempt categories');
  await page.shot('tax-abb-off');
  await page.click({ text: 'Charge ABB' });
  await page.wait(400);
  assert.ok((await menu()).taxCategories.some((c) => c.kind === 'taxed'), 'ABB is back on');
}
