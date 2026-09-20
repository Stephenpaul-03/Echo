import { Platform } from "react-native";
import { useEffect, useRef } from "react";

/**
 * Web-only: closes overlays on Escape for keyboard accessibility.
 */
export function useEscapeToClose(
  enabled: boolean,
  onEscape: () => void,
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscapeRef.current();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}

