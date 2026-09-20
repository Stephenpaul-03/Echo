import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nowPlaying, stampTrack } from './bridge';
import type { ConnectionStatus, DataSourceMode, TrackSnapshot, TransportAction } from './types';

type PendingSkipAcknowledgement = {
  action: 'skipNext' | 'skipPrevious';
  remaining: number;
  resolve: () => void;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useNowPlaying() {
  const [track, setTrack] = useState<TrackSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(nowPlaying ? 'loading' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [dataSourceMode, setDataSourceModeState] = useState<DataSourceMode>('poweramp');
  const currentTrack = useRef<TrackSnapshot | null>(null);
  const commandQueue = useRef(Promise.resolve());
  const acknowledgement = useRef<PendingSkipAcknowledgement | null>(null);
  const acceptTrack = useCallback((next: TrackSnapshot | null) => {
    const previous = currentTrack.current;
    currentTrack.current = next;
    setTrack(next);
    const pending = acknowledgement.current;
    const changed = previous?.id !== next?.id || previous?.queueItemId !== next?.queueItemId;
    if (pending && (!next || changed)) {
      const expectedDirection = pending.action === 'skipNext' ? 1 : -1;
      const knownOffset = next && next.sessionId === previous?.sessionId
        ? previous?.neighbors.find((cover) => cover.id === next.queueItemId)?.offset
        : undefined;
      const moved = knownOffset != null && Math.sign(knownOffset) === expectedDirection
        ? Math.abs(knownOffset)
        : changed ? 1 : pending.remaining;
      pending.remaining -= moved;
      if (pending.remaining <= 0) {
        acknowledgement.current = null;
        pending.resolve();
      }
    }
  }, []);
  const lastUpdate = useRef(0);
  const refreshing = useRef(false);
  const mounted = useRef(false);
  const failures = useRef(0);
  const refresh = useCallback(async () => {
    if (!nowPlaying || refreshing.current) return;
    refreshing.current = true;
    try {
      const health = await nowPlaying.refreshSessions();
      if (!mounted.current) return;
      lastUpdate.current = performance.now();
      failures.current = 0;
      acceptTrack(health.track ? stampTrack(health.track) : null);
      setStatus(!health.permission ? 'permission' : !health.connected ? 'disconnected' : health.track ? 'ready' : 'empty');
    } catch (cause) {
      if (__DEV__) console.warn('Echo session refresh failed', cause);
      if (mounted.current && ++failures.current >= 2) setStatus('disconnected');
    } finally {
      refreshing.current = false;
    }
  }, [acceptTrack]);

  useEffect(() => {
    mounted.current = true;
    if (!nowPlaying) return () => { mounted.current = false; };
    const addListener = typeof nowPlaying.addListener === 'function'
      ? nowPlaying.addListener.bind(nowPlaying)
      : null;
    const subscriptions: { remove: () => void }[] = [];
    if (addListener) {
      try {
        subscriptions.push(
          addListener('onTrackUpdate', (next) => {
            lastUpdate.current = performance.now();
            failures.current = 0;
            acceptTrack(stampTrack(next));
            setStatus('ready');
            setError(null);
          }),
          addListener('onNoSession', () => {
            lastUpdate.current = performance.now();
            acceptTrack(null);
            setStatus('empty');
          }),
          addListener('onDisconnected', () => {
            setStatus('disconnected');
            void refresh();
          }),
        );
      } catch (cause) {
        if (__DEV__) console.warn('Echo event listeners unavailable', cause);
      }
    }
    void nowPlaying.getDataSourceMode?.().then((mode) => {
      if (mounted.current) setDataSourceModeState(mode === 'auto' ? 'poweramp' : mode);
    }).catch(() => {});
    void refresh();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    // This is a health check, never the progress animation's clock.
    const watchdog = setInterval(() => {
      if (AppState.currentState === 'active' && performance.now() - lastUpdate.current >= 10_000) void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      acknowledgement.current?.resolve();
      acknowledgement.current = null;
      subscriptions.forEach((subscription) => subscription.remove());
      appState.remove();
      clearInterval(watchdog);
    };
  }, [refresh, acceptTrack]);

  const requestPermission = useCallback(async () => {
    try { await nowPlaying?.requestPermission(); }
    catch { setError('Could not open notification access. Please open Android Settings and search for Notification access.'); }
  }, []);

  const setDataSourceMode = useCallback(async (mode: DataSourceMode) => {
    if (!nowPlaying?.setDataSourceMode) return;
    setDataSourceModeState(mode);
    setStatus('loading');
    setError(null);
    try {
      const health = await nowPlaying.setDataSourceMode(mode);
      if (!mounted.current) return;
      lastUpdate.current = performance.now();
      acceptTrack(health.track ? stampTrack(health.track) : null);
      setStatus(!health.permission ? 'permission' : !health.connected ? 'disconnected' : health.track ? 'ready' : 'empty');
    } catch {
      if (mounted.current) setError('Could not switch the music connection method.');
    }
  }, [acceptTrack]);

  const control = useCallback((action: TransportAction, positionMs = 0, requestedCount = 1) => {
    const sessionId = currentTrack.current?.sessionId;
    // Every swipe gets a turn. Resolve against the latest session after each confirmation.
    commandQueue.current = commandQueue.current.then(async () => {
      const current = currentTrack.current;
      if (!mounted.current || !nowPlaying || !current || current.sessionId !== sessionId || !current.actions.includes(action)) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const skip = action === 'skipNext' || action === 'skipPrevious';
      const count = skip ? Math.max(1, Math.min(6, Math.floor(Number.isFinite(requestedCount) ? requestedCount : 1))) : 1;
      let resolveConfirmation = () => {};
      const confirmation = skip ? new Promise<void>((resolve) => {
        resolveConfirmation = resolve;
        acknowledgement.current = { action: action as 'skipNext' | 'skipPrevious', remaining: count, resolve };
        timer = setTimeout(resolve, Math.max(1000, count * 750));
      }) : Promise.resolve();
      try {
        for (let step = 0; step < count; step++) {
          const latest = currentTrack.current;
          if (!mounted.current || !latest || latest.sessionId !== sessionId || !latest.actions.includes(action)) {
            resolveConfirmation();
            break;
          }
          const accepted = await nowPlaying.control(action, latest.sessionId, positionMs);
          if (!accepted) {
            resolveConfirmation();
            setError('The music app is no longer available. Reconnecting…');
            await refresh();
            return;
          }
          // Poweramp throttles next/previous commands at roughly 200ms.
          if (skip && step < count - 1) await wait(210);
        }
        await confirmation;
        await refresh();
      } catch {
        if (mounted.current) setError('That control is unavailable. Try again in your music app.');
      } finally {
        if (timer) clearTimeout(timer);
        if (acknowledgement.current?.resolve === resolveConfirmation) acknowledgement.current = null;
      }
    });
    return commandQueue.current;
  }, [refresh]);

  return { track, status, error, dataSourceMode, setDataSourceMode, refresh, requestPermission, control };
}
