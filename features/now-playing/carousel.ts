import type { TrackSnapshot } from './types';

/** Return the signed number of queue items committed by a drag. */
export function carouselSkipSteps(displacement: number, velocity: number, maxForward: number, maxBackward: number) {
  'worklet';

  const distance = Math.abs(displacement);
  const flicked = distance > 0.06 && Math.abs(velocity) > 500;
  if (distance <= 0.22 && !flicked) return 0;
  const direction = displacement >= 0 ? 1 : -1;
  const available = direction > 0 ? maxForward : maxBackward;
  if (available <= 0) return 0;
  const requested = Math.max(1, Math.round(distance));
  return direction * Math.min(requested, available);
}

/** Keep each queue item in the same coordinate space when the active item changes. */
export function advanceCarouselOrigin(previous: TrackSnapshot, next: TrackSnapshot, origin: number) {
  if (previous.sessionId !== next.sessionId) return 0;
  if (previous.queueItemId === next.queueItemId && previous.id === next.id) return origin;
  const incoming = previous.neighbors.find((cover) => cover.id === next.queueItemId);
  if (incoming) return origin + incoming.offset;
  const outgoing = next.neighbors.find((cover) => cover.id === previous.queueItemId);
  return outgoing ? origin - outgoing.offset : origin;
}
