/**
 * ---
 * purpose: Gate multiplayer behind the configured Machination Clerk identity while leaving offline play independent.
 * related:
 *   - ./OnlineOperation.tsx - account-aware operation connection
 * ---
 */
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { AccountSignIn } from './AccountSignIn';
import type { AccountAccess } from './account-auth';

const accountUrl = process.env.EXPO_PUBLIC_CLERK_ACCOUNT_URL?.trim();
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
export function AccountProvider({ children }: { children: React.ReactNode }) {
  if (!publishableKey) return children;
  return <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>{children}</ClerkProvider>;
}
export function MultiplayerAccount({ children }: { children: (account?: AccountAccess) => React.ReactNode }) {
  return publishableKey ? <AccountGate>{children}</AccountGate> : children();
}
function AccountGate({ children }: { children: (account?: AccountAccess) => React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const [error, setError] = useState('');
  if (!isLoaded) return <ActivityIndicator accessibilityLabel="Loading account" />;
  if (!isSignedIn || !userId) return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}><Text style={{ color: '#e5eadc', fontSize: 22 }}>Machination account</Text><Text style={{ color: '#b4c7ca' }}>Sign in to create, join, or restore a multiplayer operation.</Text><AccountSignIn /><Text style={{ color: '#b4c7ca' }}>Solo and tactical practice are available offline.</Text></ScrollView>;
  return <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>{accountUrl ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(accountUrl).catch(() => setError('Could not open your account.'))} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#b8e986' }}>Machination account ↗</Text></Pressable> : <Text style={{ flex: 1, color: '#b4c7ca' }}>Machination account</Text>}<Pressable accessibilityRole="button" onPress={() => void signOut().catch(() => setError('Sign-out could not complete. Try again.'))} style={{ padding: 12 }}><Text style={{ color: '#b4c7ca' }}>Sign out</Text></Pressable></View>{!!error && <Text accessibilityRole="alert" style={{ color: '#ffbb91', paddingHorizontal: 16 }}>{error}</Text>}<React.Fragment key={userId}>{children({ accountId: userId, getToken })}</React.Fragment></View>;
}
