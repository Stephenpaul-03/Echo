import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedPaperModal } from '@/components/modal';
import { useEchoTheme } from '@/features/theme/theme';
import type { DataSourceMode } from '@/features/now-playing/types';

const choices: { mode: DataSourceMode; icon: 'sparkles-outline' | 'musical-notes-outline' | 'notifications-outline'; label: string; detail: string }[] = [
  { mode: 'poweramp', icon: 'musical-notes-outline', label: 'PowerAmp API', detail: 'Read the queue and controls from PowerAmp.' },
  { mode: 'fallback', icon: 'notifications-outline', label: 'Notification / MediaSession', detail: 'Use Android’s general media session connection.' },
];

export function DataSourcePanel({ visible, selected, onSelect, onClose }: {
  visible: boolean;
  selected: DataSourceMode;
  onSelect: (mode: DataSourceMode) => void;
  onClose: () => void;
}) {
  const { colors } = useEchoTheme();
  return <AnimatedPaperModal visible={visible} onDismiss={onClose} presentation="modal">
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View><Text style={[styles.eyebrow, { color: colors.accent }]}>MUSIC CONNECTION</Text><Text style={[styles.title, { color: colors.text }]}>Choose a source</Text></View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close music connection" style={styles.close}><Ionicons name="close" size={22} color={colors.muted} /></Pressable>
      </View>
      <View style={styles.choices}>{choices.map((choice) => {
        const active = choice.mode === selected;
        return <Pressable key={choice.mode} onPress={() => { onSelect(choice.mode); onClose(); }} accessibilityRole="radio" accessibilityState={{ checked: active }} style={[styles.choice, { backgroundColor: active ? colors.tint : colors.background, borderColor: active ? colors.accent : colors.border }]}>
          <Ionicons name={choice.icon} size={21} color={active ? colors.accent : colors.muted} />
          <View style={styles.copy}><Text style={[styles.label, { color: active ? colors.accent : colors.text }]}>{choice.label}</Text><Text style={[styles.detail, { color: colors.muted }]}>{choice.detail}</Text></View>
          {active && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
        </Pressable>;
      })}</View>
    </View>
  </AnimatedPaperModal>;
}

const styles = StyleSheet.create({
  panel: { width: 430, maxWidth: '100%', borderRadius: 24, borderWidth: 1, padding: 24, gap: 22 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 8, letterSpacing: 2, marginBottom: 8 },
  title: { fontSize: 24, letterSpacing: -0.5 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  choices: { gap: 10 },
  choice: { minHeight: 70, borderRadius: 15, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 4 },
  label: { fontSize: 13 },
  detail: { fontSize: 10, lineHeight: 14 },
});
