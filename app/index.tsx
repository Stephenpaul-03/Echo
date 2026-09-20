import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectionState } from '@/components/dashboard/connection-state';
import { CoverFlow } from '@/components/dashboard/cover-flow';
import { useEchoTheme } from '@/features/theme/theme';
import { useVolume } from '@/features/now-playing/use-volume';
import { useVisualTrack } from '@/features/now-playing/use-visual-track';
import { TransportControls } from '@/components/dashboard/transport-controls';
import type { TransportAction } from '@/features/now-playing/types';
import { nowPlaying } from '@/features/now-playing/bridge';
import { useNowPlaying } from '@/features/now-playing/use-now-playing';
import { DataSourcePanel } from '@/components/dashboard/data-source-panel';
import { ToolsPanel } from '@/components/dashboard/tools-panel';

function Awake() { useKeepAwake(); return null; }

export default function Dashboard() {
  useEffect(() => {
    void nowPlaying?.setLandscapeOrientation();
    return () => { void nowPlaying?.resetOrientation(); };
  }, []);
  const live = useNowPlaying();
  const refreshQueue = live.refresh;
  const selectedDataSourceMode = live.dataSourceMode;
  const selectDataSource = live.setDataSourceMode;
  const { colors, setAppearance } = useEchoTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [barsHidden, setBarsHidden] = useState(Platform.OS !== 'android');
  const reducedMotion = useReducedMotion();
  const legacyAndroid = Platform.OS === 'android' && Number(Platform.Version) <= 28;
  const track = live.track;
  const visualTrack = useVisualTrack(track);
  const wordmarkProgress = useSharedValue(track?.playing ? 0 : 1);
  useEffect(() => {
    wordmarkProgress.value = withTiming(track?.playing ? 0 : 1, { duration: reducedMotion ? 0 : 260 });
  }, [reducedMotion, track?.playing, wordmarkProgress]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sourcePanelVisible, setSourcePanelVisible] = useState(false);
  const controlsProgress = useSharedValue(0);
  const toolsProgress = useSharedValue(0);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => subscription.remove();
  }, []);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = live.status === 'ready';
  const barsVisible = connected && !!track && controlsVisible;
  const volume = useVolume(track?.sessionId ?? null, connected);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!screenReader) hideTimer.current = setTimeout(() => setControlsVisible(false), 10_000);
  }, [screenReader]);
  const showControls = useCallback(() => {
    setControlsVisible(true);
    controlsProgress.value = reducedMotion ? 1 : withSpring(1, { damping: 23, stiffness: 230, mass: 0.8 });
    scheduleHide();
  }, [controlsProgress, reducedMotion, scheduleHide]);
  const hideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(false);
    controlsProgress.value = reducedMotion ? 0 : withSpring(0, { damping: 25, stiffness: 230, mass: 0.8 });
  }, [controlsProgress, reducedMotion]);
  const keepControlsVisible = useCallback(() => {
    if (controlsVisible) scheduleHide();
  }, [controlsVisible, scheduleHide]);
  const hasStarted = useRef(false);
  useEffect(() => {
    if (track && !hasStarted.current) {
      hasStarted.current = true;
      scheduleHide();
    }
  }, [track, scheduleHide]);
  const transportMotion = useAnimatedStyle(() => ({
    opacity: controlsProgress.value,
    transform: [{ translateY: (1 - controlsProgress.value) * 90 }],
  }));
  useEffect(() => {
    controlsProgress.value = controlsVisible
      ? reducedMotion ? 1 : withSpring(1, { damping: 23, stiffness: 230, mass: 0.8 })
      : reducedMotion ? 0 : withSpring(0, { damping: 25, stiffness: 230, mass: 0.8 });
  }, [controlsVisible, controlsProgress, reducedMotion]);
  useEffect(() => {
    toolsProgress.value = barsVisible
      ? reducedMotion ? 1 : withSpring(1, { damping: 23, stiffness: 230, mass: 0.8 })
      : reducedMotion ? 0 : withSpring(0, { damping: 25, stiffness: 230, mass: 0.8 });
  }, [barsVisible, reducedMotion, toolsProgress]);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  useEffect(() => {
    const hideBars = () => {
      if (Platform.OS !== 'android') {
        setBarsHidden(true);
        return;
      }
      void NavigationBar.setVisibilityAsync('hidden')
        .catch(() => {})
        .finally(() => setBarsHidden(true));
    };
    hideBars();
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') hideBars();
    });
    return () => subscription.remove();
  }, []);

  // Safe-area providers can retain the old three-button navigation inset after
  // immersive mode has hidden the bars. Once the request completes, lay out
  // against the full window so the carousel and controls reclaim that space.
  const layoutInsets = barsHidden ? { top: 0, bottom: 0, left: 0, right: 0 } : insets;

  const control = useCallback((action: TransportAction, position?: number, count = 1) => {
    void live.control(action, position, count);
  }, [live]);
  const skipFromCarousel = useCallback((action: 'skipNext' | 'skipPrevious', count = 1) => {
    control(action, undefined, count);
  }, [control]);
  const pollQueue = useCallback(() => { void refreshQueue(); }, [refreshQueue]);
  const chooseDataSource = useCallback(() => setSourcePanelVisible(true), []);
  const toggleTheme = useCallback(() => {
    setAppearance({ mode: colors.dark ? 'light' : 'dark' });
  }, [colors.dark, setAppearance]);
  const themeIcon = colors.dark ? 'moon-outline' : 'sunny-outline';
  const wordmarkMotion = useAnimatedStyle(() => ({ opacity: wordmarkProgress.value }));
  const headerMotion = useAnimatedStyle(() => ({
    opacity: 1 - toolsProgress.value,
    transform: [{ translateY: -toolsProgress.value * 18 }],
  }));
  const gestureStartY = useSharedValue(-1);
  const safeWidth = width - layoutInsets.left - layoutInsets.right;
  const compact = safeWidth < 780;
  const panelWidth = Math.max(1, Math.min(1020, compact ? safeWidth - 24 : (safeWidth - 64) * 0.86));
  const portrait = height > width;
  const panelHeightRatio = portrait ? 0.78 : compact ? 0.56 : 0.46;
  const maxPanelHeight = Math.max(80, Math.min(compact ? 500 : 420, panelWidth * panelHeightRatio, height - layoutInsets.top - layoutInsets.bottom - 24));
  const minPanelHeight = Math.max(80, Math.min(compact ? 500 : 420, panelWidth * panelHeightRatio, height - layoutInsets.top - layoutInsets.bottom - (compact ? 160 : 172)));
  const albumMotion = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(Math.max(controlsProgress.value, toolsProgress.value), [0, 1], [0, -24]) },
      { scale: interpolate(Math.max(controlsProgress.value, toolsProgress.value), [0, 1], [1, maxPanelHeight > 0 ? minPanelHeight / maxPanelHeight : 1]) },
    ],
  }));
  const isCompactStage = panelWidth < 780;
  const artworkSize = portrait
    ? Math.min(maxPanelHeight * 0.74, panelWidth * 0.74)
    : Math.min(maxPanelHeight * (isCompactStage ? 0.96 : 0.9), panelWidth * (isCompactStage ? 0.46 : 0.42));
  const artworkTop = (height - artworkSize - (portrait ? 70 : 0)) / 2;
  const artworkBottom = artworkTop + artworkSize;
  const hasArtwork = !!track && connected;
  const openingDirection = useSharedValue(0);
  const revealGesture = useMemo(() => Gesture.Pan()
    .onBegin((event) => { gestureStartY.value = event.absoluteY; })
    .activeOffsetY([-28, 28]).failOffsetX([-24, 24])
    .onEnd((event) => {
      const startedAtTop = gestureStartY.value >= 0 && gestureStartY.value < 64;
      const startedAtBottom = gestureStartY.value > height - 64;
      const startedOnArtwork = hasArtwork && gestureStartY.value >= artworkTop && gestureStartY.value <= artworkBottom;
      const startedInBarArea = startedAtTop || startedAtBottom || startedOnArtwork;
      const pulledDown = event.translationY > 45;
      const pulledUp = event.translationY < -45;

      if (controlsVisible) {
        const reversePull = openingDirection.value > 0 ? pulledUp
          : openingDirection.value < 0 ? pulledDown
            : (startedAtTop || startedOnArtwork) && pulledUp || startedAtBottom && pulledDown;
        if (startedInBarArea && reversePull) {
          openingDirection.value = 0;
          runOnJS(hideControls)();
        }
      } else if ((startedAtTop || startedOnArtwork) && pulledDown) {
        openingDirection.value = 1;
        runOnJS(showControls)();
      } else if (startedAtBottom && pulledUp) {
        openingDirection.value = -1;
        runOnJS(showControls)();
      } else if (pulledUp) {
        openingDirection.value = -1;
        runOnJS(showControls)();
      }
    }), [artworkBottom, artworkTop, controlsVisible, gestureStartY, hasArtwork, height, hideControls, openingDirection, showControls]);
  return (
    <GestureDetector gesture={revealGesture}>
    <View style={[styles.screen, { backgroundColor: colors.background }]}> 
      {foreground && connected && <Awake />}
      {!legacyAndroid && colors.background !== '#000000' && visualTrack?.artwork && <View pointerEvents="none" style={styles.ambient}>
        <Image source={{ uri: visualTrack.artwork }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={55} cachePolicy="memory-disk" transition={0} />
      </View>}
      <LinearGradient pointerEvents="none" colors={colors.background === '#000000' ? [colors.background, colors.background, colors.background] : [`${colors.background}dd`, `${colors.background}80`, `${colors.background}f5`]} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents={barsVisible ? 'none' : 'auto'} style={[styles.header, { top: Math.max(16, layoutInsets.top + 8), left: Math.max(24, layoutInsets.left + 12), right: Math.max(24, layoutInsets.right + 12) }, headerMotion]}>
        <View style={styles.brand}><View style={styles.brandMark}>{[8, 17, 24, 13].map((h, i) => <View key={i} style={[styles.brandLine, { height: h, backgroundColor: colors.accent }]} />)}</View><Animated.Text style={[styles.wordmark, { color: colors.text }, wordmarkMotion]}>echo</Animated.Text></View>
        <View style={styles.statusRow}>
          <Pressable
              accessibilityRole="button"
              accessibilityHint="Choose the music connection method"
              accessibilityLabel={connected ? (track?.sessionId === 'poweramp' ? 'Poweramp API connection' : 'Fallback media session connection') : 'No active music connection'}
              hitSlop={16}
              onPress={chooseDataSource}
              style={styles.statusButton}
            >
              <View style={[styles.statusDot, {
                backgroundColor: connected
                  ? track?.sessionId === 'poweramp' ? colors.accent : '#e05252'
                  : colors.subtle,
              }]} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={[styles.statusText, { color: colors.muted }]}
              >{connected ? track?.source.toUpperCase() : 'NOW PLAYING'}</Text>
            </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={colors.dark ? 'Switch to light mode' : 'Switch to dark mode'} onPress={toggleTheme} style={styles.appearanceButton}>
            <Ionicons name={themeIcon} size={19} color={colors.accent} />
          </Pressable>
        </View>
      </Animated.View>
      {track && connected ? (
        <View style={[styles.main, { paddingLeft: layoutInsets.left, paddingRight: layoutInsets.right }]}>
          <Animated.View style={[{ width: panelWidth, height: maxPanelHeight }, albumMotion]}>
          <CoverFlow key={(visualTrack ?? track).sessionId} track={visualTrack ?? track} width={panelWidth} height={maxPanelHeight} onSkip={skipFromCarousel} onInteraction={controlsVisible ? hideControls : showControls} onQueuePoll={pollQueue} />
          </Animated.View>
          {track.buffering && <Text style={[styles.buffering, { color: colors.muted }]}>Waiting for your music app…</Text>}
        </View>
      ) : <ScrollView contentContainerStyle={[styles.empty, { minHeight: height, paddingTop: 70, paddingBottom: layoutInsets.bottom + 25, paddingLeft: layoutInsets.left + 24, paddingRight: layoutInsets.right + 24 }]}><ConnectionState status={live.status} onConnect={live.requestPermission} onRetry={live.refresh} /></ScrollView>}
      {track && connected && <Animated.View pointerEvents={controlsVisible ? 'auto' : 'none'} style={[styles.transport, { bottom: Math.max(12, layoutInsets.bottom + 4), left: layoutInsets.left + 24, right: layoutInsets.right + 24 }, transportMotion]}>
        <View style={styles.controlRow}>
          <TransportControls track={track} onControl={control} onInteraction={keepControlsVisible} />
        </View>
      </Animated.View>}
      {live.error && <Pressable accessibilityRole="button" accessibilityLabel="Retry music connection" onPress={live.refresh} style={[styles.error, { backgroundColor: colors.warningSurface }]}><Text style={[styles.errorText, { color: colors.warningText }]}>{live.error}</Text></Pressable>}
      <DataSourcePanel visible={sourcePanelVisible} selected={selectedDataSourceMode} onSelect={(mode) => void selectDataSource(mode)} onClose={() => setSourcePanelVisible(false)} />
      <ToolsPanel visible={barsVisible} state={volume} onInteraction={keepControlsVisible} />
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  appearanceButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  controlRow: { width: '100%', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'center', gap: 12 },
  screen: { flex: 1, backgroundColor: '#080b09', overflow: 'hidden' },
  ambient: { ...StyleSheet.absoluteFillObject, opacity: 0.28 },
  header: { position: 'absolute', zIndex: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { flexDirection: 'row', gap: 3, alignItems: 'center', height: 24 },
  brandLine: { width: 2, borderRadius: 2, backgroundColor: '#c1d1b7' },
  wordmark: { fontSize: 21, letterSpacing: -0.8, color: '#e0e6d9', fontWeight: '500' },
  statusRow: { flexShrink: 1, minWidth: 0, marginLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusButton: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6c7869' },
  connectedDot: { backgroundColor: '#bedaa4' },
  statusText: { fontSize: 8, letterSpacing: 4, color: '#9ca794', flexShrink: 1, minWidth: 0, lineHeight: 14, paddingVertical: 2, textAlign: 'center' },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  transport: { position: 'absolute', alignItems: 'center' },
  buffering: { position: 'absolute', bottom: 104, color: '#9ca794', fontSize: 11 },
  error: { position: 'absolute', top: 62, left: 24, right: 24, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: '#302b21' },
  errorText: { color: '#e1cfaa', fontSize: 12 },
});
