import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';
import { useEchoTheme } from '@/features/theme/theme';
import type { ConnectionStatus } from '@/features/now-playing/types';

export function ConnectionState({ status, onConnect, onRetry }: {
  status: ConnectionStatus; onConnect: () => void; onRetry: () => void;
}) {
  const { colors } = useEchoTheme();
  const reducedMotion = useReducedMotion();
  const entrance = useSharedValue(0);
  useEffect(() => {
    entrance.value = reducedMotion ? 1 : 0;
    entrance.value = withTiming(1, { duration: reducedMotion ? 0 : 420 });
  }, [entrance, reducedMotion]);
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * 18 }, { scale: 0.96 + entrance.value * 0.04 }],
  }));
  const permission = status === 'permission';
  const disconnected = status === 'disconnected';
  const unsupported = status === 'unsupported';
  const loading = status === 'loading';
  const title = permission ? 'Your music. A little more present.' : disconnected ? 'Let’s get back in sync.' : unsupported ? 'A little room for your music.' : loading ? 'Finding your music…' : 'The room is yours.';
  const description = permission
    ? 'This skin is made for Poweramp. Install Poweramp and start a song to use it. Without Poweramp, you can try the notification-based connection with another player; more skins are coming soon.'
    : disconnected ? 'Echo has lost its connection to Android. Retry, or check that notification access is still enabled.'
    : unsupported ? 'Install an Echo development build to connect your music.'
    : loading ? 'Listening for an active music session.' : 'Start a song in Spotify, YouTube Music, or your favorite player. It will find its way here.';
  return (
    <Animated.View style={[styles.panel, entranceStyle]}>
      <View style={[styles.symbol, { backgroundColor: colors.tint, borderColor: colors.border }]}><Ionicons name={disconnected ? 'link-outline' : 'musical-notes-outline'} size={28} color={colors.accent} /></View>
      <Text style={[styles.eyebrow, { color: colors.accent }]}>{permission ? 'WELCOME TO ECHO' : 'A SPACE FOR SOUND'}</Text>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
      <View style={styles.actions}>
        {(permission || disconnected) && <Pressable accessibilityRole="button" onPress={permission ? onConnect : onRetry} style={[styles.primary, { backgroundColor: colors.accent }]}><Text style={[styles.primaryText, { color: colors.onAccent }]}>{permission ? 'Connect your music' : 'Reconnect'}</Text><Ionicons name="arrow-forward" size={16} color={colors.onAccent} /></Pressable>}
      </View>
      {permission && <Text style={[styles.note, { color: colors.subtle }]}>Poweramp is the recommended connection for this skin.{ '\n' }Notification-based support is available for other music apps.</Text>}
      {disconnected && <Pressable accessibilityRole="button" onPress={onConnect} style={styles.settings}><Text style={[styles.secondaryText, { color: colors.muted }]}>Open notification access settings</Text></Pressable>}
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  panel: { alignItems: 'center', maxWidth: 520, padding: 20 },
  symbol: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#c6dbb60c', borderWidth: 1, borderColor: '#c6dbb618', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  eyebrow: { color: '#8a9a8a', fontSize: 9, letterSpacing: 2.8, marginBottom: 14 },
  title: { color: '#edf0e8', fontSize: 28, letterSpacing: -1, textAlign: 'center', marginBottom: 12 },
  description: { color: '#939c93', fontSize: 13, lineHeight: 21, textAlign: 'center', maxWidth: 390 },
  actions: { flexDirection: 'row', gap: 18, alignItems: 'center', marginTop: 22 },
  primary: { minHeight: 44, borderRadius: 24, paddingHorizontal: 19, backgroundColor: '#dce8d3', flexDirection: 'row', alignItems: 'center', gap: 14 },
  primaryText: { color: '#17231b', fontSize: 12, fontWeight: '600' },
  secondary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryText: { fontSize: 11, color: '#9daa9f' },
  note: { marginTop: 16, fontSize: 10, lineHeight: 16, textAlign: 'center', color: '#707d72' },
  settings: { minHeight: 44, justifyContent: 'center' },
});
