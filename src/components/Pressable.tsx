/**
 * ---
 * purpose: React Native Pressable that sounds a press cue, so every control in the app gives audible feedback.
 * ---
 */
import React, { forwardRef } from 'react';
import { Pressable as NativePressable, type PressableProps, type View } from 'react-native';
import { pressCueFor, pressFeedback, type PressCue } from '../audio/press';

/** `sound` overrides the cue inferred from the label and role; `null` keeps the control silent. */
export type SoundPressableProps = PressableProps & { sound?: PressCue | null };

export const Pressable = forwardRef<View, SoundPressableProps>(function Pressable({ sound, onPress, ...props }, ref) {
  return (
    <NativePressable
      ref={ref}
      {...props}
      onPress={onPress && (event => {
        pressFeedback(sound === undefined ? pressCueFor(props as Parameters<typeof pressCueFor>[0]) : sound);
        onPress(event);
      })}
    />
  );
});
