import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useHostedAuth } from '@clerk/expo/hosted-auth';

export function AccountSignIn() {
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn() {
    setBusy(true); setError('');
    try { await startHostedAuth(); }
    catch { setError('Sign-in could not complete. Try again.'); }
    finally { setBusy(false); }
  }
  return <View><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void signIn()} style={{ padding: 16 }}><Text style={{ color: '#b8e986' }}>{busy ? 'Opening sign-in…' : 'Sign in or create an account'}</Text></Pressable>{!!error && <Text accessibilityRole="alert" style={{ color: '#ffbb91' }}>{error}</Text>}</View>;
}
