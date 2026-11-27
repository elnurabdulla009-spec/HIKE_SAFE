// Walks through the prototype like a real person and saves screenshots
// to e2e/screenshots/ (backup slides for the presentation).
import { expect, test, type Page } from '@playwright/test';

const RED = 'rgb(163, 38, 27)'; // colors.red in src/components/ui.tsx
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByPlaceholder('you@example.com').fill('demo@hikesafe.kz');
  await button(page, 'Send code').click();
  await page.getByPlaceholder('123456').fill('123456');
  await button(page, 'Sign in').click();
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
}

test('full demo journey: sign in → contact → plan → live → GPS lost → offline → SOS → back safe', async ({ page }) => {
  // 1. Sign in
  await page.goto('./');
  await expect(page.getByText(/Return safely/)).toBeVisible();
  await shot(page, '01-sign-in');
  await page.getByPlaceholder('you@example.com').fill('demo@hikesafe.kz');
  await button(page, 'Send code').click();
  await page.getByPlaceholder('123456').fill('123456');
  await shot(page, '02-code');
  await button(page, 'Sign in').click();

  // 2. Home: no contact yet, and the 112 disclaimer (safety rule 6)
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
  await expect(page.getByText(/does not call 112/)).toBeVisible();
  await shot(page, '03-home-empty');

  // 3. Add a trusted contact
  await button(page, 'Add trusted contact').click();
  await page.getByPlaceholder('e.g. Aigerim (sister)').fill('Aigerim');
  await page.getByPlaceholder('+77011234567').fill('+77011234567');
  await button(page, 'Save contact').click();
  await expect(page.getByText('+77011234567', { exact: true })).toBeVisible();
  await shot(page, '04-contact-saved');
  await page.goBack();
  await expect(page.getByText('Trusted contact: Aigerim')).toBeVisible();

  // 4. Plan a hike
  await button(page, 'Plan a hike').click();
  await page.getByText('Big Almaty Lake', { exact: true }).click();
  await expect(page.getByText(/Planned return:/)).toBeVisible();
  await shot(page, '05-plan');
  await button(page, 'Start hike').click();

  // 5. Live screen
  await expect(page.getByText(/Low risk/)).toBeVisible();
  await expect(page.getByText(/Moving · GPS signal OK/)).toBeVisible();
  await shot(page, '06-live-walking');

  // 6. GPS lost → "Location unknown", never "Not moving" (safety rule 1)
  await page.getByText('GPS lost', { exact: true }).click();
  await expect(page.getByText(/^Location unknown · GPS signal lost/)).toBeVisible();
  await expect(page.getByText(/Location unknown — no GPS signal/)).toBeVisible();
  await expect(page.getByText(/Not moving/)).toHaveCount(0);
  await shot(page, '07-gps-lost');

  // 7. Offline → alert is queued, contact has NOT been told (safety rule 4)
  await page.getByText('Offline', { exact: true }).click();
  await expect(page.getByText(/has NOT been told yet/)).toBeVisible();
  await expect(page.getByText('Contact notified.')).toHaveCount(0);
  await shot(page, '08-offline-queued');

  // 8. SOS asks for confirmation first (safety rule 5)
  await button(page, 'SOS').click();
  await expect(page.getByText('Send SOS to your trusted contact now?')).toBeVisible();
  await expect(page.getByText('This does not call 112. If you can, call 112 yourself.')).toBeVisible();
  await shot(page, '09-sos-confirm');
  await button(page, 'Yes, send SOS').click();
  await expect(page.getByText(/SOS is active/)).toBeVisible();
  await expect(page.getByText('Contact notified.')).toHaveCount(0);
  await shot(page, '10-sos-active');

  // 9. Back safe → home, hike listed as finished
  await button(page, "I'm back safe").click();
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
  await expect(page.getByText(/Big Almaty Lake .*back safe/)).toBeVisible();
  await shot(page, '11-back-home');
});

test('wrong sign-in code shows a red error', async ({ page }) => {
  await page.goto('./');
  await page.getByPlaceholder('you@example.com').fill('demo@hikesafe.kz');
  await button(page, 'Send code').click();
  await page.getByPlaceholder('123456').fill('000000');
  await button(page, 'Sign in').click();
  const error = page.getByText(/Wrong code/);
  await expect(error).toBeVisible();
  await expect(error).toHaveCSS('color', RED);
  await expect(page.getByText('Ready for a hike?')).toHaveCount(0);
  await shot(page, 'err-01-wrong-code');
});

test('phone without +7 shows a red error', async ({ page }) => {
  await signIn(page);
  await button(page, 'Add trusted contact').click();
  await page.getByPlaceholder('e.g. Aigerim (sister)').fill('Aigerim');
  await page.getByPlaceholder('+77011234567').fill('87011234567');
  await button(page, 'Save contact').click();
  const error = page.getByText(/Phone must look like/);
  await expect(error).toBeVisible();
  await expect(error).toHaveCSS('color', RED);
  await shot(page, 'err-02-bad-phone');
});

test('reloading a deep link does not show a 404 page', async ({ page }) => {
  await page.goto('contacts');
  // The app loads (it sends a signed-out user to sign-in) instead of a "404 Not Found" page.
  await expect(page.getByText(/Return safely/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Return safely/)).toBeVisible();
});
