import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nowPlaying } from './bridge';
import type { VolumeState } from './types';

export function useVolume(sessionId: string | null, enabled = true) {
  const [volume, setVolume] = useState<VolumeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const activeSession = useRef(sessionId);
  const mounted = useRef(true);
  activeSession.current = sessionId;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (!enabled) { setVolume(null); return () => { mounted.current = false; }; }
    setError(null);
    setVolume(null);
    const refresh = async () => {
      if (!nowPlaying?.getVolume || AppState.currentState !== 'active') return;
      try { const value = await nowPlaying.getVolume(sessionId); if (active) setVolume(value); } catch { /* Keep controls unavailable on old builds. */ }
    };
    void refresh();
    let subscription: { remove: () => void } | undefined;
    if (typeof nowPlaying?.addListener === 'function') {
      try {
        subscription = nowPlaying.addListener('onVolumeChanged', (value) => {
          if (active && value.sessionId === sessionId) setVolume(value);
        });
      } catch (cause) {
        if (__DEV__) console.warn('Echo volume events unavailable', cause);
      }
    }
    // Hardware volume buttons need to be reflected even when metadata doesn't change.
    const timer = setInterval(refresh, 1500);
    return () => { active = false; mounted.current = false; clearInterval(timer); subscription?.remove(); };
  }, [sessionId, enabled]);
  const change = useCallback((level: number | null, direction = 0) => {
    queue.current = queue.current.then(async () => {
      if (!nowPlaying?.changeVolume || activeSession.current !== sessionId || !mounted.current) return;
      try {
        const next = await nowPlaying.changeVolume(sessionId, level, direction);
        if (activeSession.current === sessionId && mounted.current) { setVolume(next); setError(null); }
      } catch { if (mounted.current) setError('Volume is unavailable for this output.'); }
    });
  }, [sessionId]);
  return { volume, change, error };
}
