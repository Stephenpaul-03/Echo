import test from 'node:test';
import assert from 'node:assert/strict';
// Node's built-in TypeScript runner requires explicit extensions.
// @ts-ignore -- Metro uses extensionless imports in application code.
import { positionAt, formatTime } from '../features/now-playing/progress.ts';
const anchor = { positionMs: 1000, durationMs: 10000, playing: true, buffering: false, playbackSpeed: 1, receivedAt: 5000 };
test('interpolates elapsed time and playback speed', () => {
  assert.equal(positionAt(anchor, 6500), 2500);
  assert.equal(positionAt({ ...anchor, playbackSpeed: 1.5 }, 7000), 4000);
});
test('freezes paused and buffering playback', () => {
  assert.equal(positionAt({ ...anchor, playing: false }, 9000), 1000);
  assert.equal(positionAt({ ...anchor, buffering: true }, 9000), 1000);
});
test('clamps to duration and ignores clock skew', () => {
  assert.equal(positionAt(anchor, 50000), 10000);
  assert.equal(positionAt(anchor, 4000), 1000);
});
test('supports unknown duration and a new seek anchor', () => {
  assert.equal(positionAt({ ...anchor, durationMs: 0 }, 50000), 46000);
  assert.equal(positionAt({ ...anchor, positionMs: 6000, receivedAt: 9000 }, 9500), 6500);
});
test('formats long and negative durations', () => {
  assert.equal(formatTime(125000), '2:05');
  assert.equal(formatTime(-10), '0:00');
  assert.equal(formatTime(3600000), '60:00');
});
