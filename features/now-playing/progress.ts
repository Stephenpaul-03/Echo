import type { TrackSnapshot } from './types';

type PositionAnchor = Pick<TrackSnapshot, 'positionMs' | 'durationMs' | 'playing' | 'buffering' | 'playbackSpeed' | 'receivedAt'>;

export function positionAt(track: PositionAnchor, now: number): number {
  'worklet';
  const elapsed = track.playing && !track.buffering ? Math.max(0, now - track.receivedAt) * track.playbackSpeed : 0;
  const position = Math.max(0, track.positionMs + elapsed);
  return track.durationMs > 0 ? Math.min(track.durationMs, position) : position;
}

export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
