import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const clamp = (value: number) => {
  'worklet';
  return Math.max(0, Math.min(1, value));
};

export function ContinuousSlider({
  value,
  disabled = false,
  railColor,
  fillColor,
  showThumb = true,
  height = 44,
  accessibilityLabel,
  accessibilityValue,
  onAccessibilityAction,
  onChange,
  onInteraction,
}: {
  value: number;
  disabled?: boolean;
  railColor: string;
  fillColor: string;
  showThumb?: boolean;
  height?: number;
  accessibilityLabel: string;
  accessibilityValue: { min: number; max: number; now: number; text?: string };
  onAccessibilityAction: (direction: -1 | 1) => void;
  onChange: (value: number) => void;
  onInteraction: () => void;
}) {
  const width = useSharedValue(1);
  const position = useSharedValue(clamp(value));
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!dragging.value) position.value = withTiming(clamp(value), { duration: 90 });
  }, [dragging, position, value]);

  const gesture = useMemo(() => {
    const update = (x: number) => {
      'worklet';
      position.value = clamp(x / width.value);
    };
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .activeOffsetX([-2, 2])
      .failOffsetY([-18, 18])
      .onStart((event) => {
        dragging.value = true;
        cancelAnimation(position);
        update(event.x);
        runOnJS(onInteraction)();
      })
      .onUpdate((event) => update(event.x))
      .onEnd(() => runOnJS(onChange)(position.value))
      .onFinalize(() => { dragging.value = false; });
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .maxDistance(8)
      .onEnd((event, success) => {
        if (!success) return;
        cancelAnimation(position);
        update(event.x);
        runOnJS(onInteraction)();
        runOnJS(onChange)(position.value);
      });
    return Gesture.Race(pan, tap);
  }, [disabled, dragging, onChange, onInteraction, position, width]);

  const fillStyle = useAnimatedStyle(() => ({ width: width.value * position.value }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: width.value * position.value - 5 }] }));

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => onAccessibilityAction(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={[styles.hitArea, { height }]}
      onLayout={(event) => { width.value = Math.max(1, event.nativeEvent.layout.width); }}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View style={styles.gestureSurface}>
          <View pointerEvents="none" style={[styles.rail, { backgroundColor: railColor }]}>
            <Animated.View style={[styles.fill, { backgroundColor: fillColor }, fillStyle]} />
          </View>
          {showThumb && <Animated.View pointerEvents="none" style={[styles.thumb, { backgroundColor: fillColor }, thumbStyle]} />}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { flex: 1, minWidth: 36, justifyContent: 'center' },
  gestureSurface: { flex: 1, justifyContent: 'center' },
  rail: { width: '100%', height: 3, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 3 },
  thumb: { position: 'absolute', left: 0, top: '50%', marginTop: -5, width: 10, height: 10, borderRadius: 5 },
});
