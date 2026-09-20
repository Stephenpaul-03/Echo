import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { DataSourceMode, SessionHealth, TrackSnapshot, TransportAction, VolumeState } from './types';

type NativeTrack = Omit<TrackSnapshot, 'receivedAt'>;
type Events = {
  onTrackUpdate: (track: NativeTrack) => void;
  onNoSession: () => void;
  onDisconnected: () => void;
  onVolumeChanged: (volume: VolumeState) => void;
};

declare class NowPlayingModule extends NativeModule<Events> {
  refreshSessions(): Promise<SessionHealth>;
  getDataSourceMode(): Promise<DataSourceMode>;
  setDataSourceMode(mode: DataSourceMode): Promise<SessionHealth>;
  getVolume(sessionId: string | null): Promise<VolumeState>;
  changeVolume(sessionId: string | null, level: number | null, direction: number): Promise<VolumeState>;
  getAppearance(): Promise<{ mode: string; accent: string }>;
  setAppearance(mode: string, accent: string): Promise<void>;
  getPermissionStatus(): Promise<boolean>;
  requestPermission(): Promise<void>;
  setLandscapeOrientation(): Promise<void>;
  resetOrientation(): Promise<void>;
  control(action: TransportAction, sessionId: string, positionMs: number): Promise<boolean>;
}

export const nowPlaying = Platform.OS === 'android'
  ? requireOptionalNativeModule<NowPlayingModule>('NowPlaying')
  : null;

export function stampTrack(track: NativeTrack): TrackSnapshot {
  return { ...track, receivedAt: performance.now() };
}
