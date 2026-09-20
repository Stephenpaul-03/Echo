import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore -- Node's TypeScript runner requires explicit extensions.
import { reconcileVisualTrack } from '../features/now-playing/visual-track.ts';
// @ts-ignore -- Node's TypeScript runner requires explicit extensions.
import { advanceCarouselOrigin, carouselSkipSteps } from '../features/now-playing/carousel.ts';
import type { TrackSnapshot } from '../features/now-playing/types';

const previous: TrackSnapshot = {
  id: 'track-4', sessionId: 'player', queueItemId: '4', source: 'Player',
  title: 'Four', artist: 'Artist', album: 'Album', artwork: 'file:///four.jpg',
  durationMs: 10000, positionMs: 0, playbackSpeed: 1, playing: true,
  buffering: false, receivedAt: 0, actions: ['skipNext', 'skipPrevious'],
  neighbors: Array.from({ length: 10 }, (_, index) => index + 1).filter((id) => id !== 4)
    .map((id) => ({ id: String(id), title: String(id), artist: 'Artist', artwork: `file:///${id}.jpg`, offset: id - 4 })),
};

test('keeps prefetched art and the full lookahead through an empty queue update', () => {
  const { next, retained } = reconcileVisualTrack({ ...previous, id: 'track-5', queueItemId: '5', artwork: null, neighbors: [] }, previous);
  assert.equal(next.artwork, 'file:///5.jpg');
  assert.equal(retained?.find((cover) => cover.id === '4')?.offset, -1);
  assert.equal(retained?.find((cover) => cover.id === '10')?.offset, 5);
  assert.ok(retained?.every((cover) => cover.offset !== 0));
});

test('keeps mounted neighbor artwork when metadata temporarily omits it', () => {
  const { next, retained } = reconcileVisualTrack({ ...previous, artwork: null,
    neighbors: previous.neighbors.map((cover) => ({ ...cover, artwork: null })) }, previous);
  assert.equal(next.artwork, previous.artwork);
  assert.equal(next.neighbors[0].artwork, previous.neighbors[0].artwork);
  assert.equal(retained, null);
});

test('does not reuse queue IDs or artwork across music sessions', () => {
  const { next, retained } = reconcileVisualTrack({ ...previous, sessionId: 'other-player', artwork: null, neighbors: [] }, previous);
  assert.equal(next.artwork, null);
  assert.equal(retained, null);
});

test('does not invent neighbors when a queue jump has no known anchor', () => {
  const { next, retained } = reconcileVisualTrack({ ...previous, id: 'unknown', queueItemId: '99', artwork: null, neighbors: [] }, previous);
  assert.equal(next.artwork, null);
  assert.equal(retained, null);
});

test('accepts a replacement queue instead of retaining removed items', () => {
  const neighbors = [{ id: 'new', title: 'New', artist: 'Artist', artwork: null, offset: 1 }];
  const { next, retained } = reconcileVisualTrack({ ...previous, neighbors }, previous);
  assert.deepEqual(next.neighbors, neighbors);
  assert.equal(retained, null);
});

test('a long carousel drag commits multiple known queue items', () => {
  assert.equal(carouselSkipSteps(2.6, 0, 3, 3), 3);
  assert.equal(carouselSkipSteps(1.6, 0, 3, 3), 2);
  assert.equal(carouselSkipSteps(-2.4, 0, 3, 2), -2);
});

test('multi-item drag targets respect queue boundaries and flick thresholds', () => {
  assert.equal(carouselSkipSteps(2.8, 0, 2, 2), 2);
  assert.equal(carouselSkipSteps(0.18, 0, 3, 3), 0);
  assert.equal(carouselSkipSteps(0.1, 600, 3, 3), 1);
  assert.equal(carouselSkipSteps(1.2, 0, 0, 3), 0);
});

test('a confirmed drag keeps every retained card in the same coordinate space', () => {
  const next = { ...previous, id: 'track-5', queueItemId: '5', neighbors: [] };
  const origin = advanceCarouselOrigin(previous, next, 20);
  assert.equal(origin, 21);
  // The incoming card was at 20 + 1 and is now at 21 + 0. Focus can finish uninterrupted.
  assert.equal(20 + previous.neighbors.find((cover) => cover.id === '5')!.offset, origin);
});

test('reverse drags and queue jumps preserve the signed distance', () => {
  assert.equal(advanceCarouselOrigin(previous, { ...previous, queueItemId: '3' }, 20), 19);
  assert.equal(advanceCarouselOrigin(previous, { ...previous, queueItemId: '8' }, 20), 24);
});

test('new queue can supply the anchor when the old queue was missing', () => {
  const next = { ...previous, id: 'track-5', queueItemId: '5', neighbors: [
    { id: '4', title: 'Four', artist: 'Artist', artwork: previous.artwork, offset: -1 },
  ] };
  assert.equal(advanceCarouselOrigin({ ...previous, neighbors: [] }, next, 20), 21);
});

test('metadata-only updates preserve origin and new sessions reset it', () => {
  assert.equal(advanceCarouselOrigin(previous, { ...previous, title: 'Updated' }, 20), 20);
  assert.equal(advanceCarouselOrigin(previous, { ...previous, sessionId: 'other' }, 20), 0);
});
