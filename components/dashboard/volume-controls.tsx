import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEchoTheme } from '@/features/theme/theme';
import type { useVolume } from '@/features/now-playing/use-volume';
import { ContinuousSlider } from './continuous-slider';

export function VolumeControls({ state, onInteraction }: { state: ReturnType<typeof useVolume>; onInteraction: () => void }) {
  const { colors } = useEchoTheme();
  const { volume, change, error } = state;
  const displayed = volume?.level ?? 0;
  const enabled = !!volume?.adjustable;
  const adjust = (direction: number) => { onInteraction(); change(null, direction); };
  return <View style={styles.wrapper}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Lower volume" disabled={!enabled} onPress={() => adjust(-1)} style={[styles.button, !enabled && styles.disabled]}><Ionicons name="volume-low-outline" color={colors.muted} size={19} /></Pressable>
      <View style={styles.slider}>
        <ContinuousSlider
          value={displayed}
          disabled={!volume?.absolute}
          railColor={colors.rail}
          fillColor={colors.accent}
          showThumb={!!volume?.absolute}
          accessibilityLabel={volume?.remote ? 'Remote output volume' : 'Media volume'}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(displayed * 100) }}
          onAccessibilityAction={adjust}
          onChange={(level) => change(level)}
          onInteraction={onInteraction}
        />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Raise volume" disabled={!enabled} onPress={() => adjust(1)} style={[styles.button, !enabled && styles.disabled]}><Ionicons name="volume-high-outline" color={colors.muted} size={19} /></Pressable>
    </View>
      <Text style={[styles.label, { color: error ? colors.warningText : colors.subtle }]}>{error ?? (!volume ? 'Volume unavailable' : !enabled ? 'Fixed volume output' : `${volume.remote ? 'REMOTE VOLUME' : 'VOLUME'}  ${Math.round(displayed * 100)}%`)}</Text>
  </View>;
}
const styles = StyleSheet.create({
  wrapper: { width: 280, flexShrink: 0, alignItems: 'center' }, row: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  slider: { width: 200, height: 44 },
  label: { fontSize: 8, letterSpacing: 0.8, textAlign: 'center' }, disabled: { opacity: 0.3 },
});
