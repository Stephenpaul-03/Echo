import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEchoTheme } from '@/features/theme/theme';
import { formatTime, positionAt } from '@/features/now-playing/progress';
import type { TrackSnapshot, TransportAction } from '@/features/now-playing/types';
import { ContinuousSlider } from './continuous-slider';

export function TransportControls({ track, onControl, onInteraction }: {
  track: TrackSnapshot;
  onControl: (action: TransportAction, position?: number) => void;
  onInteraction: () => void;
}) {
  const { colors } = useEchoTheme();
  const [elapsed, setElapsed] = useState(track.positionMs);
  useEffect(() => {
    const position = positionAt(track, performance.now());
    setElapsed(position);
    const timer = setInterval(() => setElapsed(positionAt(track, performance.now())), 1000);
    return () => clearInterval(timer);
  }, [track]);
  const trigger = (action: TransportAction, position?: number) => { onInteraction(); onControl(action, position); };
  const seek = (fraction: number) => {
    const position = fraction * track.durationMs;
    setElapsed(position);
    trigger('seekTo', position);
  };
  const toggle = track.playing ? 'pause' : 'play';
  return (
    <View style={styles.container}>
      <View style={styles.progressRow}>
        <Text style={[styles.time, { color: colors.muted }]}>{formatTime(elapsed)}</Text>
        <ContinuousSlider
          value={track.durationMs > 0 ? elapsed / track.durationMs : 0}
          disabled={!track.actions.includes('seekTo') || track.durationMs <= 0}
          railColor={colors.rail}
          fillColor={colors.accent}
          showThumb={false}
          height={32}
          accessibilityLabel="Track progress"
          accessibilityValue={{ min: 0, max: track.durationMs || 1, now: Math.min(elapsed, track.durationMs || elapsed), text: `${formatTime(elapsed)} of ${track.durationMs ? formatTime(track.durationMs) : 'unknown duration'}` }}
          onAccessibilityAction={(direction) => trigger('seekTo', Math.max(0, Math.min(track.durationMs, elapsed + direction * 10000)))}
          onChange={seek}
          onInteraction={onInteraction}
        />
        <Text style={[styles.time, { color: colors.muted }]}>{track.durationMs > 0 ? formatTime(track.durationMs) : '—:—'}</Text>
      </View>
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous track" disabled={!track.actions.includes('skipPrevious')} onPress={() => trigger('skipPrevious')} style={[styles.button, !track.actions.includes('skipPrevious') && styles.disabled]}>
          <Ionicons name="play-skip-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={track.playing ? 'Pause' : 'Play'} disabled={!track.actions.includes(toggle)} onPress={() => trigger(toggle)} style={[styles.playButton, { backgroundColor: colors.accent }, !track.actions.includes(toggle) && styles.disabled]}>
          <Ionicons name={track.playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next track" disabled={!track.actions.includes('skipNext')} onPress={() => trigger('skipNext')} style={[styles.button, !track.actions.includes('skipNext') && styles.disabled]}>
          <Ionicons name="play-skip-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { width: 360, minWidth: 220, flexShrink: 1, gap: 0, alignItems: 'center' },
  progressRow: { width: '100%', flexDirection: 'row', gap: 12, alignItems: 'center' },
  time: { fontSize: 10, color: '#a4ada7', fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 21, alignItems: 'center' },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e0e9dd', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.25 },
});
