// Browser check for the Tax tab and typing menu prices without ABB (TAX01).
// MUTATES THE SAMPLE MENU AND TAX SETUP. Run through `npm run e2e`, which starts the throwaway till at localhost:3082.
import assert from 'node:assert/strict';

export default async function (page) {
  await page.size(1180, 820);
  await page.login('1234');
  assert.equal(await page.eval('location.origin'), 'http://localhost:3082', 'Use the throwaway till that `npm run e2e` starts');
  const text = (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const menu = () => page.eval(`fetch('/api/menu', { headers: { 'x-token': JSON.parse(localStorage.getItem('cactus.session')).token } }).then((r) => r.json())`);
  await page.eval(`localStorage.removeItem('cactus.admin.pricesWithoutAbb')`);

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

  /* Typing a price without ABB: $15.00 at 6% is stored as $15.90; the receipt gets the same $0.90 back. */
  await page.click({ text: 'Menu' });
  await page.click('[aria-label="Edit: Burger"]');
  assert.equal(await page.eval(`document.querySelector('.admin-dialog input[inputmode=decimal]').value`), '14.00');
  await page.click({ text: 'Type prices without ABB' });
  assert.equal(await page.eval(`document.querySelector('.admin-dialog input[inputmode=decimal]').value`), '13.21', 'Shows the price without its ABB');
  await page.type('.admin-dialog input[inputmode=decimal]', '15.00');
  assert.match(await text('.admin-dialog'), /Customer pays \$15\.90, of which \$0\.90 ABB \(6%\)/);
  await page.shot('menu-price-without-abb');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(400);
  assert.equal((await menu()).items.find((i) => i.id === 'burger').priceCents, 1590, 'Stored with ABB in it');

  /* Opening and saving untouched in that mode keeps the price to the cent. */
  await page.click('[aria-label="Edit: Burger"]');
  assert.equal(await page.eval(`document.querySelector('.admin-dialog input[inputmode=decimal]').value`), '15.00');
  await page.click('.admin-dialog-actions .primary');
  await page.wait(400);
  assert.equal((await menu()).items.find((i) => i.id === 'burger').priceCents, 1590);
  await page.eval(`localStorage.removeItem('cactus.admin.pricesWithoutAbb')`);
}
