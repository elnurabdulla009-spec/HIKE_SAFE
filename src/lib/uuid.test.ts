/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { uuidv4 } from './uuid.ts';

describe('uuidv4', () => {
  it('has the UUID v4 shape that Postgres accepts', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 1000; i++) assert.match(uuidv4(), re);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 10_000 }, uuidv4));
    assert.equal(seen.size, 10_000);
  });
});
