import type { TrackSnapshot } from './types';

/** Reuse artwork only within a session and retain queue entries only with a known anchor. */
export function reconcileVisualTrack(track: TrackSnapshot, visible: TrackSnapshot | null) {
  const sameSession = visible?.sessionId === track.sessionId;
  const known = new Map(sameSession ? visible.neighbors.map((cover) => [cover.id, cover.artwork]) : []);
  if (sameSession && visible.queueItemId != null) known.set(visible.queueItemId, visible.artwork);
  const artwork = track.artwork
    ?? (track.queueItemId != null ? known.get(track.queueItemId) : null)
    ?? (sameSession && visible.id === track.id ? visible.artwork : null);
  const next = { ...track, artwork: artwork ?? null, neighbors: track.neighbors.map((cover) => ({
    ...cover, artwork: cover.artwork ?? known.get(cover.id) ?? null,
  })) };
  // Some players briefly clear their queue while publishing the next track.
  // Retain only known entries that can be aligned to the confirmed queue item.
  const oldCovers = sameSession ? [
    ...visible.neighbors,
    ...(visible.queueItemId != null ? [{ id: visible.queueItemId, title: visible.title,
      artist: visible.artist, artwork: visible.artwork, offset: 0 }] : []),
  ] : [];
  const anchor = oldCovers.find((cover) => cover.id === track.queueItemId);
  const retained = next.neighbors.length === 0 && anchor && oldCovers.length > 1
    ? oldCovers.map((cover) => ({ ...cover, offset: cover.offset - anchor.offset }))
      .filter((cover) => cover.offset !== 0 && Math.abs(cover.offset) <= 6)
    : null;
  return { next, retained };
}
