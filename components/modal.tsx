import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  StyleProp,
  useWindowDimensions,
  ViewStyle,
} from "react-native";
import { Modal, Portal, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useEchoTheme } from "@/features/theme/theme";

type Presentation = "modal" | "sheet";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  presentation?: Presentation;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentWrapperStyle?: StyleProp<ViewStyle>;
  zIndex?: number;
  escapeEnabled?: boolean;
  dismissable?: boolean;
  keyboardAware?: boolean;
  includeBottomInset?: boolean;
};

export function AnimatedPaperModal({
  visible,
  onDismiss,
  children,
  presentation = "modal",
  style,
  contentContainerStyle,
  contentWrapperStyle,
  zIndex = 1000,
  escapeEnabled = true,
  dismissable = true,
  keyboardAware = false,
  includeBottomInset = true,
}: Props) {
  const { height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const paperTheme = useTheme();
  const { colors } = useEchoTheme();
  const hiddenTranslateY = Math.max(0, Math.floor(height));
  const progress = useRef(new Animated.Value(0)).current;
  const backdropProgress = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(hiddenTranslateY)).current;
  const gestureStartTranslateY = useRef(0);
  const [rendered, setRendered] = useState(visible);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEscapeToClose(visible && escapeEnabled, onDismiss);

  const combinedModalStyle = useMemo(() => {
    if (presentation !== "sheet") {
      return [
        {
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          zIndex,
          elevation: zIndex,
        },
        style,
      ];
    }
    return [
      {
        justifyContent: "flex-end",
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        zIndex,
        elevation: zIndex,
      },
      style,
    ] as any;
  }, [presentation, style, zIndex]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.stopAnimation();
      backdropProgress.stopAnimation();
      sheetTranslateY.stopAnimation();
      progress.setValue(0);
      backdropProgress.setValue(0);
      if (presentation === "sheet") sheetTranslateY.setValue(hiddenTranslateY);

      Animated.parallel([
        Animated.timing(progress, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropProgress, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    progress.stopAnimation();
    backdropProgress.stopAnimation();
    sheetTranslateY.stopAnimation();
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropProgress, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: hiddenTranslateY,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [
    backdropProgress,
    hiddenTranslateY,
    presentation,
    progress,
    sheetTranslateY,
    visible,
  ]);

  useEffect(() => {
    if (!keyboardAware || presentation !== "sheet" || !visible) {
      setKeyboardHeight(0);
      return;
    }

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardAware, presentation, visible]);

  const sheetPanResponder = useMemo(() => {
    if (presentation !== "sheet" || !dismissable) return null;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (event, gesture) => {
        const isDownwardSwipe =
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
        const startedNearHandle = event.nativeEvent.locationY <= 72;
        return isDownwardSwipe && startedNearHandle;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderGrant: () => {
        backdropProgress.stopAnimation();
        sheetTranslateY.stopAnimation((value) => {
          gestureStartTranslateY.current =
            typeof value === "number" ? Math.max(0, value) : 0;
        });
      },
      onPanResponderMove: (_event, gesture) => {
        const nextTranslate = Math.min(
          hiddenTranslateY,
          Math.max(0, gestureStartTranslateY.current + gesture.dy),
        );
        sheetTranslateY.setValue(nextTranslate);
        backdropProgress.setValue(
          1 - Math.min(1, nextTranslate / Math.max(hiddenTranslateY, 1)),
        );
      },
      onPanResponderRelease: (_event, gesture) => {
        const shouldDismiss =
          gesture.dy > Math.min(140, height * 0.18) || gesture.vy > 1.2;

        if (shouldDismiss) {
          onDismiss();
        }

        Animated.timing(sheetTranslateY, {
          toValue: shouldDismiss ? hiddenTranslateY : 0,
          duration: shouldDismiss ? 180 : 220,
          easing: shouldDismiss
            ? Easing.in(Easing.cubic)
            : Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        Animated.timing(backdropProgress, {
          toValue: shouldDismiss ? 0 : 1,
          duration: shouldDismiss ? 180 : 220,
          easing: shouldDismiss
            ? Easing.in(Easing.cubic)
            : Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        Animated.timing(backdropProgress, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    });
  }, [
    dismissable,
    height,
    hiddenTranslateY,
    onDismiss,
    presentation,
    backdropProgress,
    sheetTranslateY,
  ]);

  const combinedContentContainerStyle = useMemo(() => {
    if (presentation !== "sheet") return contentContainerStyle;
    return [
      {
        alignSelf: "stretch",
        width: "100%",
        paddingBottom:
          keyboardAware && keyboardHeight > 0
            ? Math.max(bottom, keyboardHeight + 20)
            : includeBottomInset
              ? bottom
              : 0,
      },
      contentContainerStyle,
      {
        borderTopLeftRadius: 40,
        borderTopRightRadius: 40,
        transform: [{ translateY: sheetTranslateY }],
      },
    ] as any;
  }, [
    bottom,
    contentContainerStyle,
    includeBottomInset,
    keyboardAware,
    keyboardHeight,
    presentation,
    sheetTranslateY,
  ]);

  const contentAnimationStyle = useMemo(
    () =>
      presentation === "sheet"
        ? {
            opacity: progress,
          }
        : {
            opacity: progress,
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.98, 1],
                }),
              },
            ],
          },
    [presentation, progress],
  );

  // Sheet modals avoid the keyboard by lifting the bottom-anchored container.
  // Center modals still use KeyboardAvoidingView around their content.
  const wrappedChildren =
    keyboardAware && presentation !== "sheet" ? (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 24}
      >
        {children}
      </KeyboardAvoidingView>
    ) : (
      children
    );

  return (
    <Portal>
        <Modal
          visible={rendered}
          onDismiss={onDismiss}
          dismissable={dismissable}
          style={combinedModalStyle}
          contentContainerStyle={combinedContentContainerStyle}
          theme={{
            ...paperTheme,
            colors: { ...paperTheme.colors, backdrop: colors.overlay },
          }}
        >
          {presentation === "sheet" && sheetPanResponder ? (
            <Animated.View
              style={[
                { alignSelf: "stretch", flexShrink: 1 },
                contentWrapperStyle,
                contentAnimationStyle,
              ]}
              {...sheetPanResponder.panHandlers}
            >
              {wrappedChildren}
            </Animated.View>
          ) : (
            <Animated.View style={contentAnimationStyle}>
              {wrappedChildren}
            </Animated.View>
          )}
        </Modal>
    </Portal>
  );
}
