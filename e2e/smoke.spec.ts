// Walks through the prototype like a real person and saves screenshots
// to e2e/screenshots/ (backup slides for the presentation).
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const RED = 'rgb(163, 38, 27)'; // colors.red in src/components/ui.tsx
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const chip = (page: Page, label: string) => page.getByText(label, { exact: true });

async function signIn(page: Page) {
  await page.goto('./');
  await page.getByPlaceholder('you@example.com').fill('demo@hikesafe.kz');
  await button(page, 'Send code').click();
  await page.getByPlaceholder('123456').fill('123456');
  await button(page, 'Sign in').click();
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
}

async function addContactAndStartHike(page: Page) {
  await button(page, 'Add trusted contact').click();
  await page.getByPlaceholder('e.g. Aigerim (sister)').fill('Aigerim');
  await page.getByPlaceholder('+77011234567').fill('+77011234567');
  await button(page, 'Save contact').click();
  await expect(page.getByText('+77011234567', { exact: true })).toBeVisible();
  await page.goBack();
  await button(page, 'Plan a hike').click();
  await chip(page, 'Big Almaty Lake').click();
  await button(page, 'Start hike').click();
  await expect(page.getByText(/Moving · GPS signal OK/)).toBeVisible();
}

/** The hidden observer entrance: tap the "HIKE SAFE" header title 3 times. */
async function openPilot(page: Page) {
  const title = page.getByLabel('HIKE SAFE').last();
  for (let i = 0; i < 3; i++) await title.click();
  await expect(page.getByText('Pilot mode (observer)')).toBeVisible();
}

test('full demo journey (presentation mode): sign in → contact → plan → live → GPS lost → offline → preview → SOS → reload → back safe', async ({ page }) => {
  // 0. Presentation: the observer turns the demo panel ON (hidden by default for participants)
  await page.goto('pilot');
  await button(page, 'Show demo panel on app screens').click();
  await expect(page.getByText(/Demo panel is ON/)).toBeVisible();
  await button(page, 'Back to app').click();

  // 1. Sign in
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
  await chip(page, 'Big Almaty Lake').click();
  await expect(page.getByText(/Planned return:/)).toBeVisible();
  await shot(page, '05-plan');
  await button(page, 'Start hike').click();

  // 5. Live screen
  await expect(page.getByText(/Low risk/)).toBeVisible();
  await expect(page.getByText(/Moving · GPS signal OK/)).toBeVisible();
  await shot(page, '06-live-walking');

  // 6. GPS lost → "Location unknown", never "Not moving" (safety rule 1)
  await chip(page, 'GPS lost').click();
  await expect(page.getByText(/^Location unknown · GPS signal lost/)).toBeVisible();
  await expect(page.getByText(/Location unknown — no GPS signal/)).toBeVisible();
  await expect(page.getByText(/Not moving/)).toHaveCount(0);
  await shot(page, '07-gps-lost');

  // 7. Offline → alert is queued, contact has NOT been told (safety rule 4)
  await chip(page, 'Offline').click();
  await expect(page.getByText(/has NOT been told yet/)).toBeVisible();
  await expect(page.getByText('Contact notified.')).toHaveCount(0);
  await shot(page, '08-offline-queued');

  // 8. GPS lost again (same incident stays open) → preview what the contact sees
  await chip(page, 'GPS lost').click();
  await expect(page.getByText(/^Location unknown · GPS signal lost/)).toBeVisible();
  await button(page, 'Preview what your contact sees').click();
  await expect(page.getByText('PREVIEW — NOT SENT')).toBeVisible();
  await expect(page.getByText(/Opening this preview does not send anything/)).toBeVisible();
  const message = page.getByLabel('Alert message');
  await expect(message).toContainText('HIKE SAFE alert for Aigerim:');
  await expect(message).toContainText('Demo is on a hike to Big Almaty Lake');
  await expect(message).toContainText(/Last known location: unknown since \d\d:\d\d/); // rule 1
  await expect(message).not.toContainText(/not moved|not moving|stopped/i);
  await expect(message).toContainText('HIKE SAFE does not call 112.');
  await expect(page.getByText(/contact notified/i)).toHaveCount(0); // rule 4
  await shot(page, '09-contact-preview');
  await page.goBack();
  await expect(page.getByText('Big Almaty Lake', { exact: true })).toBeVisible();

  // 9. SOS asks for confirmation first (safety rule 5)
  await button(page, 'SOS').click();
  await expect(page.getByText('Send SOS to your trusted contact now?')).toBeVisible();
  await expect(page.getByText('This does not call 112. If you can, call 112 yourself.')).toBeVisible();
  await shot(page, '10-sos-confirm');
  await button(page, 'Yes, send SOS').click();
  await expect(page.getByText(/SOS is active/)).toBeVisible();
  await expect(page.getByText('Contact notified.')).toHaveCount(0);
  await shot(page, '11-sos-active');

  // 10. Reload (F5) mid-hike: the hike, SOS and scenario are still there
  await page.reload();
  await expect(page.getByText('Big Almaty Lake', { exact: true })).toBeVisible();
  await expect(page.getByText(/SOS is active/)).toBeVisible();
  await expect(page.getByText(/^Location unknown · GPS signal lost/)).toBeVisible();

  // 11. Back safe → home, hike listed as finished
  await button(page, "I'm back safe").click();
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
  await expect(page.getByText(/Big Almaty Lake .*back safe/)).toBeVisible();
  await shot(page, '12-back-home');
});

test('participants do not see the demo panel or "Reset demo"', async ({ page }) => {
  await signIn(page);
  await expect(button(page, 'Reset demo')).toHaveCount(0);
  await addContactAndStartHike(page);
  await expect(page.getByText('Prototype demo: simulate a situation')).toHaveCount(0);
  await expect(chip(page, 'GPS lost')).toHaveCount(0);
  await shot(page, '13-live-participant-view');
});

test('pilot session: hidden entrance, tasks, errors, CSV export, logs survive reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  await expect(page.getByText(/Return safely/)).toBeVisible();

  // Observer: hidden entrance, refuses a name, starts P01, starts Task A
  await openPilot(page);
  await page.getByPlaceholder('P01').fill('Aigerim');
  await button(page, 'Reset demo & start session').click();
  await expect(page.getByText(/Use a participant code like P01/)).toBeVisible();
  await page.getByPlaceholder('P01').fill('p01');
  await button(page, 'Reset demo & start session').click();
  await expect(page.getByText('Session P01 is running.')).toBeVisible();
  await chip(page, 'Start A: Plan a hike').click();
  await expect(page.getByText('Current task: A — Plan a hike')).toBeVisible();
  await shot(page, '14-pilot-session');
  await button(page, 'Back to app').click();

  // Participant: one wrong code (an error), then Task A until the hike starts (auto-finish)
  await page.getByPlaceholder('you@example.com').fill('participant@test.kz');
  await button(page, 'Send code').click();
  await page.getByPlaceholder('123456').fill('000000');
  await button(page, 'Sign in').click();
  await expect(page.getByText(/Wrong code/)).toBeVisible();
  await page.getByPlaceholder('123456').fill('123456');
  await button(page, 'Sign in').click();
  await expect(page.getByText('Ready for a hike?')).toBeVisible();
  await addContactAndStartHike(page);

  // Observer: Task B with "GPS lost" chosen in Pilot mode (participant never sees the buttons)
  await openPilot(page);
  await expect(page.getByText('Current task: none')).toBeVisible();
  await chip(page, 'Start B: Read live states').click();
  await chip(page, 'GPS lost').click();
  await button(page, 'Back to app').click();
  await expect(page.getByText(/^Location unknown · GPS signal lost/)).toBeVisible();
  await expect(chip(page, 'GPS lost')).toHaveCount(0);

  // Observer: Task C, "Overdue" → an alert exists → contact reads the preview
  await openPilot(page);
  await chip(page, 'Start C: Contact reads alert').click();
  await chip(page, 'Overdue').click();
  await button(page, 'Back to app').click();
  await button(page, 'Preview what your contact sees').click();
  await expect(page.getByLabel('Alert message')).toContainText(/is now \d+ (h \d+ )?min late/);
  await page.goBack();

  // Observer: finish, end, check results and export
  await openPilot(page);
  await button(page, 'Finish current task').click();
  await button(page, 'End session').click();
  await expect(page.getByText(/^P01 · /)).toBeVisible();
  await expect(page.getByText(/Task A \(Plan a hike\): \d+:\d\d · errors 1/)).toBeVisible();
  await expect(page.getByText(/Task B \(Read live states\): \d+:\d\d · errors 0/)).toBeVisible();
  await expect(page.getByText(/Task C \(Contact reads alert\): \d+:\d\d · errors 0/)).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Download CSV').click()]);
  expect(download.suggestedFilename()).toMatch(/^hikesafe-pilot-\d{8}-\d{4}\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  const lines = csv.trimEnd().split('\n');
  expect(lines[0]).toBe('participant,session_id,event_no,time_iso,elapsed_s,type,task,detail');
  expect(lines.slice(1).every((l) => l.startsWith('P01,'))).toBe(true);
  for (const type of ['SESSION_START', 'SCREEN', 'TASK_START', 'TASK_END', 'ERROR', 'SCENARIO', 'PREVIEW_OPEN', 'SESSION_END']) {
    expect(csv).toContain(`,${type},`);
  }
  expect(csv).not.toMatch(/@|participant@test|Aigerim|\+?7701|Big Almaty/i); // privacy
  await shot(page, '15-pilot-results');

  // Logs survive a reload
  await page.reload();
  await expect(page.getByText(/Task A \(Plan a hike\): \d+:\d\d · errors 1/)).toBeVisible();

  // Copy JSON
  await button(page, 'Copy JSON').click();
  await expect(page.getByText('JSON copied to the clipboard.')).toBeVisible();
  const json = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(json.summaries[0].participant).toBe('P01');
  expect(json.summaries[0].tasks.A.errors).toBe(1);
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
