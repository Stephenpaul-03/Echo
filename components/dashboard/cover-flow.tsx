import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as NativeImage, PixelRatio, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, Extrapolation, interpolate, runOnJS, runOnUI,
  type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useEchoTheme } from '@/features/theme/theme';
import { advanceCarouselOrigin, carouselSkipSteps } from '@/features/now-playing/carousel';
import type { Cover, TrackSnapshot } from '@/features/now-playing/types';

const SETTLE_MS = 280;
const spring = { damping: 24, stiffness: 210, mass: 0.82, overshootClamping: true } as const;

const artistLabel = (value: string, album?: string) => {
  const withoutAlbum = album ? value.replace(new RegExp(`\\s*[-–—·•|]\\s*${album.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '') : value;
  return withoutAlbum.split(/\s+(?:[-–—·•|]|\n)\s+/)[0].trim() || withoutAlbum.trim() || value;
};

type CardProps = Cover & {
  album?: string;
  size: number;
  slot: number;
  focus: SharedValue<number>;
  entry: SharedValue<number>;
  legacyAndroid: boolean;
  showLabel: boolean;
};

// Stable keys and scalar props keep artwork mounted through progress and queue updates.
const CoverCard = memo(function CoverCard({ title, artist, album, artwork, offset, size, slot, focus, entry, legacyAndroid, showLabel }: CardProps) {
  const { colors } = useEchoTheme();
  const visibleArtist = artistLabel(artist, album);
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const imageSource = useMemo(() => artwork ? { uri: artwork } : null, [artwork]);
  const layer = useAnimatedStyle(() => {
    const value = slot - focus.value;
    // Keep the card nearest the focus above its neighbors during the swipe.
    return { zIndex: 20000 - Math.round(Math.abs(value) * 1000) * 2 + (value <= 0 ? 1 : 0) };
  });
  const pose = useAnimatedStyle(() => {
    const value = slot - focus.value;
    const distance = Math.abs(value);
    const entryDelay = Math.min(0.34, Math.abs(offset) * 0.1);
    const entryValue = interpolate(entry.value, [entryDelay, 1], [0, 1], Extrapolation.CLAMP);
    const translateX = Math.sign(value) * interpolate(distance, [0, 1, 2, 3, 4], [0, size * 0.62, size * 0.9, size * 1.17, size * 1.35], Extrapolation.CLAMP);
    const scale = interpolate(distance, [0, 1, 3], [1, legacyAndroid ? 0.9 : 0.86, 0.78], Extrapolation.CLAMP);
    return {
      opacity: interpolate(distance, [0, 2, 3], [1, 1, 0], Extrapolation.CLAMP) * entryValue,
      transform: legacyAndroid
        ? [{ translateX }, { scale }, { translateY: (1 - entryValue) * 18 }, { scale: 0.96 + entryValue * 0.04 }]
        : [{ perspective: size * 4 }, { translateX }, { rotateY: `${interpolate(value, [-1, 0, 1], [44, 0, -44], Extrapolation.CLAMP)}deg` }, { scale }, { translateY: (1 - entryValue) * 18 }, { scale: 0.96 + entryValue * 0.04 }],
    };
  });
  const shade = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(slot - focus.value), [0, 1, 3], [0, 0.42, 0.82], Extrapolation.CLAMP) }));
  const labelMotion = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(slot - focus.value), [0, 0.75], [1, 0], Extrapolation.CLAMP) * interpolate(entry.value, [Math.min(0.34, Math.abs(offset) * 0.1), 1], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View collapsable={false} style={[styles.cardPosition, { width: size, height: size }, layer]}>
      <Animated.View renderToHardwareTextureAndroid style={[styles.cardFace, pose]}>
      <View style={styles.cover} accessibilityElementsHidden={offset !== 0} importantForAccessibility={offset === 0 ? 'auto' : 'no-hide-descendants'}>
        {(!artwork || artwork === failedArtwork) && <LinearGradient colors={['#252b27', '#141916', '#090b0a']} style={[StyleSheet.absoluteFill, styles.roundedLayer, styles.fallback]}>
          <View style={styles.record}><View style={[styles.recordCenter, { backgroundColor: colors.accent }]} /></View>
        </LinearGradient>}
        {legacyAndroid
          ? <NativeImage source={imageSource ?? undefined} style={[styles.artwork, { opacity: artwork && artwork !== failedArtwork ? 1 : 0 }]}
              resizeMode="cover" fadeDuration={0} onLoad={() => setFailedArtwork(null)} onError={() => setFailedArtwork(artwork)} />
          : <ExpoImage source={imageSource} recyclingKey={artwork ?? undefined} style={[styles.artwork, { opacity: artwork && artwork !== failedArtwork ? 1 : 0 }]}
              contentFit="cover" cachePolicy="memory-disk" onLoad={() => setFailedArtwork(null)} onError={() => setFailedArtwork(artwork)} transition={0} />}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.12)', 'rgba(0,0,0,0.72)']} locations={[0.48, 0.67, 1]} style={[StyleSheet.absoluteFill, styles.roundedLayer]} />
        {showLabel && <Animated.View style={[styles.label, labelMotion]}>
          <View style={styles.textLine}>
            <Text style={[styles.title, { fontSize: Math.max(13, size * 0.048) }]} numberOfLines={2} ellipsizeMode="tail">{title}</Text>
          </View>
          <View style={styles.textLine}>
            <Text style={styles.artist} numberOfLines={2} ellipsizeMode="tail">{visibleArtist}</Text>
          </View>
        </Animated.View>}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shade, shade]} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.coverBorder]} />
      </View>
      </Animated.View>
    </Animated.View>
  );
});

export function CoverFlow({ track, width, height, onSkip, onInteraction, onQueuePoll }: {
  track: TrackSnapshot;
  width: number;
  height: number;
  onSkip: (action: 'skipNext' | 'skipPrevious', count?: number) => void;
  onInteraction: () => void;
  onQueuePoll: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const entrance = useSharedValue(0);
  useEffect(() => {
    entrance.value = reducedMotion ? 1 : 0;
    entrance.value = reducedMotion ? 1 : withTiming(1, { duration: 460 });
  }, [entrance, reducedMotion]);
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * 14 }, { scale: 0.975 + entrance.value * 0.025 }],
  }));
  const legacyAndroid = Platform.OS === 'android' && Number(Platform.Version) <= 28;
  const window = useWindowDimensions();
  const portrait = window.height > window.width;
  const visibleLookahead = portrait ? 1 : legacyAndroid ? 2 : 3;
  const [layout, setLayout] = useState({ track, origin: 0 });
  if (layout.track !== track) {
    setLayout({ track, origin: advanceCarouselOrigin(layout.track, track, layout.origin) });
  }
  const origin = layout.origin;
  const activeKey = track.queueItemId ?? track.id;
  // A single continuous coordinate drives every card, including during confirmation.
  const focus = useSharedValue(0);
  const entry = useSharedValue(0);
  const center = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const pendingTarget = useSharedValue(Number.NaN);
  const dragged = useSharedValue(false);
  const committed = useSharedValue(false);
  const swipeLocked = useSharedValue(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueuePoll = useRef(0);
  const handlers = useRef({ onSkip, onInteraction, onQueuePoll });
  useEffect(() => { handlers.current = { onSkip, onInteraction, onQueuePoll }; }, [onSkip, onInteraction, onQueuePoll]);
  const finishSwipe = useCallback(() => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = null;
  }, []);
  const smallStage = width < 780;
  const size = PixelRatio.roundToNearestPixel(portrait
    ? Math.min(height * 0.74, width * 0.74)
    : Math.min(height * (smallStage ? 0.96 : 0.9), width * (smallStage ? 0.46 : 0.42)));
  const duration = reducedMotion ? 0 : legacyAndroid ? 210 : SETTLE_MS;
  const settle = useCallback((value: SharedValue<number>, target: number) => {
    'worklet';
    value.value = reducedMotion || legacyAndroid
      ? withTiming(target, { duration })
      : withSpring(target, spring);
  }, [duration, legacyAndroid, reducedMotion]);
  const covers = useMemo(() => [
    ...track.neighbors.filter((cover) => Math.abs(cover.offset) <= visibleLookahead).map((cover) => ({
      ...cover, id: `${track.sessionId}/queue/${cover.id}`,
    })),
    { id: track.queueItemId != null ? `${track.sessionId}/queue/${track.queueItemId}` : `${track.sessionId}/track/${track.id}`,
      title: track.title, artist: track.artist, album: track.album, artwork: track.artwork, offset: 0 },
  ], [visibleLookahead, track.sessionId, track.id, track.queueItemId, track.title, track.artist, track.album, track.artwork, track.neighbors]);

  useEffect(() => {
    entry.value = reducedMotion ? 1 : 0;
    entry.value = reducedMotion ? 1 : withTiming(1, { duration: 620 });
  }, [entry, reducedMotion]);
  useEffect(() => {
    runOnUI((nextCenter: number) => {
      const previousCenter = center.value;
      const pending = pendingTarget.value;
      const movement = nextCenter - previousCenter;
      const wasMovingTowardTarget = Number.isFinite(pending) && (
        nextCenter === pending || movement === 0 ||
        (Math.sign(movement) === Math.sign(pending - previousCenter) && Math.abs(pending - nextCenter) < Math.abs(pending - previousCenter))
      );
      center.value = nextCenter;
      // Each confirmed queue item advances the origin. Keep one continuous drag
      // settling toward its final item instead of restarting at each update.
      if (wasMovingTowardTarget) {
        if (nextCenter === pending) {
          pendingTarget.value = Number.NaN;
          committed.value = false;
          swipeLocked.value = false;
          runOnJS(finishSwipe)();
        }
        return;
      }
      settle(focus, nextCenter);
      pendingTarget.value = Number.NaN;
      committed.value = false;
      swipeLocked.value = false;
      if (Number.isFinite(pending)) runOnJS(finishSwipe)();
    })(origin);
  }, [activeKey, track.sessionId, origin, center, focus, pendingTarget, committed, swipeLocked, finishSwipe, settle]);
  useEffect(() => () => { if (unlockTimer.current) clearTimeout(unlockTimer.current); }, []);
  const requestSkip = useCallback((action: 'skipNext' | 'skipPrevious', count: number) => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => {
      runOnUI(() => {
        settle(focus, center.value);
        pendingTarget.value = Number.NaN;
        committed.value = false;
        swipeLocked.value = false;
      })();
    }, Math.max(2200, count * 1000));
    handlers.current.onSkip(action, count);
  }, [center, committed, focus, pendingTarget, settle, swipeLocked]);
  const showControls = useCallback(() => handlers.current.onInteraction(), []);
  const pollQueue = useCallback(() => {
    const now = Date.now();
    if (now - lastQueuePoll.current < 750) return;
    lastQueuePoll.current = now;
    handlers.current.onQueuePoll();
  }, []);
  const { colors } = useEchoTheme();
  const groupHeight = size + (portrait ? 70 : 0);
  const artworkTop = PixelRatio.roundToNearestPixel(Math.max(0, (height - groupHeight) / 2));
  const visibleArtist = artistLabel(track.artist, track.album);

  const canNext = track.actions.includes('skipNext');
  const canPrevious = track.actions.includes('skipPrevious');
  const countContiguous = (direction: -1 | 1) => {
    let count = 0;
    while (count < visibleLookahead && track.neighbors.some((cover) => cover.offset === direction * (count + 1))) count++;
    return count;
  };
  const knownForward = countContiguous(1);
  const knownBackward = countContiguous(-1);
  const maxForward = canNext ? knownForward || 1 : 0;
  const maxBackward = canPrevious ? knownBackward || 1 : 0;
  const gesture = useMemo(() => {
    const swipe = Gesture.Pan().activeOffsetX([-12, 12]).failOffsetY([-24, 24])
    .onStart(() => {
      dragged.value = !swipeLocked.value;
      if (!dragged.value) return;
      cancelAnimation(focus);
      dragStart.value = focus.value;
      runOnJS(pollQueue)();
    })
    .onUpdate((event) => {
      if (!dragged.value) return;
      const proposed = dragStart.value - event.translationX / (size * 0.62);
      const next = proposed > center.value;
      const allowed = next ? canNext : canPrevious;
      const known = next ? knownForward : knownBackward;
      const limit = allowed ? (known > 0 ? known : 0.34) : 0.1;
      focus.value = center.value + Math.max(-limit, Math.min(limit, proposed - center.value));
    })
    .onEnd((event) => {
      if (!dragged.value) return;
      const displacement = focus.value - center.value;
      const steps = carouselSkipSteps(displacement, event.velocityX, maxForward, maxBackward);
      if (steps !== 0) {
        committed.value = true;
        swipeLocked.value = true;
        const target = center.value + steps;
        if (track.neighbors.some((cover) => cover.offset === steps)) {
          pendingTarget.value = target;
          // Continue from the finger's current position, never from a reset offset.
          settle(focus, target);
        }
        runOnJS(requestSkip)(steps > 0 ? 'skipNext' : 'skipPrevious', Math.abs(steps));
      }
    })
    .onFinalize(() => {
      if (dragged.value && !committed.value) settle(focus, center.value);
      dragged.value = false;
    });
    const tap = Gesture.Tap().onEnd((_event, success) => {
      if (success) runOnJS(showControls)();
    });
    return Gesture.Race(swipe, tap);
  }, [canNext, canPrevious, center, committed, dragStart, dragged, focus, knownBackward, knownForward, maxBackward, maxForward, pendingTarget, pollQueue, requestSkip, settle, showControls, size, swipeLocked, track.neighbors]);


  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessible accessibilityRole="button" accessibilityLabel={`${track.title}, ${track.artist}`}
        style={[styles.stage, { width, height }, entranceStyle]}>
        <View pointerEvents="none" style={{ position: 'absolute', left: PixelRatio.roundToNearestPixel((width - size) / 2), top: artworkTop, width: size, height: size }}>
          {covers.map((cover) => <CoverCard key={cover.id} {...cover} size={size} slot={origin + cover.offset} focus={focus} entry={entry} legacyAndroid={legacyAndroid} showLabel={!portrait} />)}
        </View>
        {portrait && <View pointerEvents="none" style={[styles.portraitInfo, { top: artworkTop + size + 10, left: 0, right: 0 }]}>
          <Text style={[styles.portraitTitle, { color: colors.text }]} numberOfLines={2} ellipsizeMode="tail">{track.title}</Text>
          <Text style={[styles.portraitArtist, { color: colors.muted }]} numberOfLines={1} ellipsizeMode="tail">{visibleArtist}</Text>
        </View>}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { backgroundColor: 'transparent', overflow: 'hidden' },
  cardFace: { ...StyleSheet.absoluteFillObject, borderRadius: 14, overflow: 'hidden', backgroundColor: '#090b0a' },
  cardPosition: { position: 'absolute', top: 0, left: 0 },
  cover: { ...StyleSheet.absoluteFillObject, borderRadius: 14, overflow: 'hidden', backgroundColor: '#090b0a' },
  artwork: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', borderRadius: 14 },
  roundedLayer: { borderRadius: 14 },
  coverBorder: { borderRadius: 14, borderWidth: 1, borderColor: '#ffffff1a' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  record: { width: '72%', aspectRatio: 1, borderRadius: 999, borderWidth: 20, borderColor: '#ffffff0b', backgroundColor: '#0f201ecc', alignItems: 'center', justifyContent: 'center' },
  recordCenter: { width: '30%', aspectRatio: 1, borderRadius: 999, backgroundColor: '#a4b8a3' },
  shade: { backgroundColor: '#000' },
  label: { position: 'absolute', bottom: '7%', left: 12, right: 12, alignItems: 'stretch', gap: 4 },
  textLine: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '500', letterSpacing: -0.5, maxWidth: '100%', paddingHorizontal: 8, textAlign: 'center', alignSelf: 'center' },
  artist: { color: '#ffffffad', fontSize: 11, lineHeight: 16, maxWidth: '100%', paddingHorizontal: 8, textAlign: 'center', alignSelf: 'center' },
  portraitInfo: { position: 'absolute', alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  portraitTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.3, textAlign: 'center', width: '100%' },
  portraitArtist: { fontSize: 12, lineHeight: 16, textAlign: 'center', width: '100%' },
});
