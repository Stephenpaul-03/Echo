export type TransportAction = 'play' | 'pause' | 'skipNext' | 'skipPrevious' | 'seekTo';
export type DataSourceMode = 'auto' | 'poweramp' | 'fallback';

export interface Cover {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  artworkPending?: boolean;
  /** Offset from the source app's active queue item. */
  offset: number;
}

export interface TrackSnapshot {
  id: string;
  sessionId: string;
  /** Stable queue identity preserves the same cover as it moves into focus. */
  queueItemId?: string | null;
  source: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  artworkPending?: boolean;
  durationMs: number;
  positionMs: number;
  playbackSpeed: number;
  playing: boolean;
  buffering: boolean;
  /** Native position is normalized at emission; JS uses its own monotonic clock. */
  receivedAt: number;
  actions: TransportAction[];
  neighbors: Cover[];
}

export interface SessionHealth {
  permission: boolean;
  connected: boolean;
  track: Omit<TrackSnapshot, 'receivedAt'> | null;
}

export type ConnectionStatus = 'loading' | 'permission' | 'ready' | 'empty' | 'disconnected' | 'unsupported';

export interface VolumeState {
  level: number;
  adjustable: boolean;
  absolute: boolean;
  remote: boolean;
  sessionId: string | null;
}
