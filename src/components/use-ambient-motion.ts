import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

export const nativeDriver = Platform.OS !== 'web';

/** Reduced-motion preference (undefined until known) and whether the app is foregrounded. */
export function useAmbientMotion() {
  const [reduced, setReduced] = useState<boolean>();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let disposed = false, changed = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', next => { changed = true; setReduced(next); });
    AccessibilityInfo.isReduceMotionEnabled()
      .then(next => { if (!disposed && !changed) setReduced(next); })
      .catch(() => { if (!disposed && !changed) setReduced(false); });
    const foreground = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { disposed = true; motion?.remove(); foreground?.remove(); };
  }, []);
  return { reduced, animate: reduced === false && active };
}
