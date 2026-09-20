import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { EchoThemeProvider, useEchoTheme } from '@/features/theme/theme';

function ThemedStack() {
  const { colors } = useEchoTheme();
  return <PaperProvider><GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
    <StatusBar hidden />
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade' }} />
  </GestureHandlerRootView></PaperProvider>;
}
export default function RootLayout() {
  return <SafeAreaProvider><EchoThemeProvider><ThemedStack /></EchoThemeProvider></SafeAreaProvider>;
}
