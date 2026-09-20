import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Image } from 'expo-image';
import type { TrackSnapshot } from './types';
import { reconcileVisualTrack } from './visual-track';

/** Keep the last complete frame until replacement artwork is ready to draw. */
export function useVisualTrack(track: TrackSnapshot | null) {
  const legacyAndroid = Platform.OS === 'android' && Number(Platform.Version) <= 28;
  const [visible, setVisible] = useState<TrackSnapshot | null>(track);
  const emptyQueueSince = useRef<number | null>(null);
  // Playback ticks must not restart image loads or the queue grace period.
  const visualKey = JSON.stringify(track && [track.sessionId, track.id, track.queueItemId,
    track.title, track.artist, track.album, track.artwork, track.artworkPending, track.neighbors, track.actions]);
  useEffect(() => {
    if (!track) { emptyQueueSince.current = null; setVisible(null); return; }
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const sameSession = visible?.sessionId === track.sessionId;
    if (!sameSession || track.neighbors.length > 0) emptyQueueSince.current = null;
    else emptyQueueSince.current ??= Date.now();
    const { next, retained } = reconcileVisualTrack(track, visible);
    // Warm the whole native lookahead, including cards outside the visible stage.
    if (!legacyAndroid) {
      for (const uri of new Set(next.neighbors.map((cover) => cover.artwork).filter((uri): uri is string => !!uri))) {
        void Image.prefetch(uri, 'memory-disk').catch(() => false);
      }
    }
    const retainFor = Math.max(0, 2000 - (Date.now() - (emptyQueueSince.current ?? Date.now())));
    let committed = false;
    const commit = () => {
      if (cancelled || committed) return;
      committed = true;
      if (timeout) clearTimeout(timeout);
      setVisible(retained && retainFor > 0 ? { ...next, neighbors: retained } : next);
      if (retained && retainFor > 0) timeout = setTimeout(() => { if (!cancelled) setVisible(next); }, retainFor);
    };
    if (legacyAndroid && next.artwork) commit();
    else if (next.artwork && next.artwork !== visible?.artwork) {
      // Prefetch finishes before mounting the new center image, avoiding a blank decode frame.
      void Image.prefetch(next.artwork, 'memory-disk').then(commit, commit);
      timeout = setTimeout(commit, 1200);
    } else if (!next.artwork && sameSession && (track.artworkPending || visible.id !== track.id)) {
      // Only a genuinely missing/failed image gets the fallback, not a pending decode.
      timeout = setTimeout(commit, track.artworkPending ? 1200 : 450);
    } else commit();
    return () => { cancelled = true; if (timeout) clearTimeout(timeout); };
    // The previous complete frame is intentionally a snapshot, not an effect trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyAndroid, visualKey]);
  return visible;
}
