/**
 * ---
 * purpose: Open one multiplayer entry task without scrolling through unrelated forms.
 * ---
 *
 * @format
 */
import React, { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';

const tasks = [
  { id: 'create', text: 'Create', label: 'Create an operation' },
  { id: 'join', text: 'Join', label: 'Join an operation' },
  { id: 'restore', text: 'Restore', label: 'Restore a seat' },
] as const;

export function OnlineEntry({
  server,
  create,
  join,
  restore,
  disabled,
}: {
  server: ReactNode;
  create: ReactNode;
  join: ReactNode;
  restore: ReactNode;
  disabled: boolean;
}) {
  const [task, setTask] = useState<(typeof tasks)[number]['id']>('create');
  return (
    <View style={s.form}>
      {server}
      <View style={s.tasks}>
        {tasks.map(({ id, text, label }) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: task === id, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!disabled) setTask(id);
            }}
            style={[s.task, task === id && s.selected, disabled && s.disabled]}
          >
            <Text style={[s.text, task === id && s.selectedText]}>{text}</Text>
          </Pressable>
        ))}
      </View>
      {{ create, join, restore }[task]}
    </View>
  );
}

const s = StyleSheet.create({
  form: { gap: 12 },
  tasks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  task: {
    flexGrow: 1,
    maxWidth: '100%',
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#3b5140',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#b8e986', borderColor: '#b8e986' },
  text: { color: '#b8e986', fontSize: 14, fontWeight: '600' },
  selectedText: { color: '#182312' },
  disabled: { opacity: 0.5 },
});
