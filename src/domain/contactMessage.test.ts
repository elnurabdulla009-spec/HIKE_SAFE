/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildContactAlert, DELIVERY_TEXT, previewNotice, type ContactAlertInput } from './contactMessage.ts';
import type { DeliveryState } from './types.ts';

const T0 = Date.UTC(2026, 11, 6, 10, 0);
const fmt = (ms: number) => `@${(ms - T0) / 60_000}`; // time-zone free: minutes after T0

const base = (over: Partial<ContactAlertInput['evaluation']> = {}, lastFixAt: number | null = T0 + 200 * 60_000): ContactAlertInput => ({
  hikerName: 'Elnur',
  contactName: 'Aigerim',
  destination: 'Big Almaty Lake',
  plannedReturnAt: T0 + 480 * 60_000,
  lastFixAt,
  formatTime: fmt,
  evaluation: { gps: 'FRESH', movement: 'MOVING', stationaryMinutes: null, minutesToReturn: -60, reasons: [], ...over },
});

const CLAIMS_STOPPED = /not moved|not moving|stopped|stationary|standing still/i;

describe('contact alert message', () => {
  it('overdue + GPS lost: says late and location UNKNOWN since the last fix (RULE 01)', () => {
    const text = buildContactAlert(base({ gps: 'STALE', movement: 'UNKNOWN', minutesToReturn: 45, reasons: ['RETURN_OVERDUE', 'GPS_UNKNOWN'] }));
    assert.match(text, /^HIKE SAFE alert for Aigerim:/);
    assert.match(text, /Elnur planned to return from Big Almaty Lake by @480 and is now 45 min late\./);
    assert.match(text, /Last known location: unknown since @200/);
    assert.doesNotMatch(text, CLAIMS_STOPPED);
  });

  it('GPS never fixed: location unknown, never "stopped"', () => {
    const text = buildContactAlert(base({ gps: 'NO_FIX', movement: 'UNKNOWN', reasons: ['GPS_UNKNOWN'] }, null));
    assert.match(text, /Last known location: unknown/);
    assert.doesNotMatch(text, CLAIMS_STOPPED);
  });

  it('"has not moved" is said ONLY when GPS is fresh and movement is STATIONARY', () => {
    const still = buildContactAlert(base({ movement: 'STATIONARY', stationaryMinutes: 95, reasons: ['LONG_STATIONARY'] }));
    assert.match(still, /GPS is working\..*has not moved for 1 h 35 min/);
    const moving = buildContactAlert(base());
    assert.match(moving, /was moving/);
    assert.doesNotMatch(moving, CLAIMS_STOPPED);
  });

  it('SOS and low battery are mentioned; 1-2-3 steps and the 112 disclaimer are always there', () => {
    const text = buildContactAlert(base({ reasons: ['MANUAL_SOS', 'LOW_BATTERY'] }));
    assert.match(text, /Elnur pressed SOS in the app\./);
    assert.match(text, /battery is low/);
    assert.match(text, /1\) call Elnur, 2\) .*3\) call 112 if you believe Elnur is in danger\. HIKE SAFE does not call 112\./);
  });

  it('the message itself never claims delivery (RULE 04)', () => {
    const text = buildContactAlert(base({ minutesToReturn: 45, reasons: ['RETURN_OVERDUE', 'MANUAL_SOS'] }));
    assert.doesNotMatch(text, /notified|delivered|has been told/i);
  });

  it('preview notice: says PREVIEW, and "Contact notified" ONLY for CONTACT_NOTIFIED (RULE 04)', () => {
    const states: DeliveryState[] = ['LOCAL_ONLY', 'QUEUED_OFFLINE', 'SENT_TO_SERVER', 'CONTACT_NOTIFIED'];
    for (const s of states) {
      const n = previewNotice(s);
      assert.match(n, /^PREVIEW:/);
      assert.match(n, /does not send anything/);
      assert.equal(/contact notified/i.test(n), s === 'CONTACT_NOTIFIED', s);
      assert.equal(/contact notified/i.test(DELIVERY_TEXT[s]), s === 'CONTACT_NOTIFIED', s);
    }
    assert.match(DELIVERY_TEXT.QUEUED_OFFLINE, /NOT been told/);
    assert.match(previewNotice(null), /nothing would be sent/);
  });
});
