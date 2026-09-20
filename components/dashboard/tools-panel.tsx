import { StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VolumeControls } from '@/components/dashboard/volume-controls';
import type { useVolume } from '@/features/now-playing/use-volume';

type Props = { visible: boolean; state: ReturnType<typeof useVolume>; onInteraction: () => void };

export function ToolsPanel({ visible, state, onInteraction }: Props) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    progress.value = visible
      ? withSpring(1, { damping: 23, stiffness: 230, mass: 0.8 })
      : withSpring(0, { damping: 25, stiffness: 230, mass: 0.8 });
  }, [progress, visible]);
  const motion = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: interpolate(progress.value, [0, 1], [-90, 0]) }] }));

  return <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[styles.overlay, motion]}>
    <View pointerEvents="box-none" style={[styles.bar, { top: insets.top + 4 }]}>
      <VolumeControls state={state} onInteraction={onInteraction} />
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, elevation: 10 },
  bar: { position: 'absolute', left: 12, right: 12, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
});
