/**
 * ---
 * purpose: Gate multiplayer behind the configured Machination Clerk identity while leaving offline play independent.
 * related:
 *   - ./OnlineOperation.tsx - account-aware operation connection
 * ---
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { ClerkProvider, useAuth, useSession } from '@clerk/expo';
import { Pressable } from '../components/Pressable';
import { tokenCache } from '@clerk/expo/token-cache';
import { AccountSignIn } from './AccountSignIn';
import type { AccountAccess } from './account-auth';

const accountUrl = process.env.EXPO_PUBLIC_CLERK_ACCOUNT_URL?.trim();
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
export function AccountProvider({ children }: { children: React.ReactNode }) {
  if (!publishableKey) return children;
  return <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>{children}</ClerkProvider>;
}
function useSessionAccount({ isLoaded, userId }: ReturnType<typeof useAuth>): AccountAccess | null | undefined {
  const { isLoaded: sessionLoaded, session } = useSession();
  return useMemo(() => {
    if (!isLoaded || !sessionLoaded) return undefined;
    if (!userId) return null;
    if (!session || session.user.id !== userId) return undefined;
    return { accountId: userId, getToken: () => session.getToken() };
  }, [isLoaded, sessionLoaded, userId, session]);
}
/** Signed-in account access; `undefined` while loading, `null` when signed out or accounts are off. */
export const useAccountAccess: () => AccountAccess | null | undefined = publishableKey
  ? () => useSessionAccount(useAuth())
  : () => null;
export function MultiplayerAccount({ children }: { children: (account?: AccountAccess) => React.ReactNode }) {
  return publishableKey ? <AccountGate>{children}</AccountGate> : children();
}
function AccountGate({ children }: { children: (account?: AccountAccess) => React.ReactNode }) {
  const auth = useAuth();
  const { isSignedIn, signOut } = auth;
  const account = useSessionAccount(auth);
  const [error, setError] = useState('');
  if (account === undefined) return <ActivityIndicator accessibilityLabel="Loading account" />;
  if (!isSignedIn || !account) return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}><Text style={{ color: '#e5eadc', fontSize: 22 }}>Machination account</Text><Text style={{ color: '#b4c7ca' }}>Sign in to create, join, or restore a multiplayer operation.</Text><AccountSignIn /><Text style={{ color: '#b4c7ca' }}>Solo and tactical practice are available offline.</Text></ScrollView>;
  return <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>{accountUrl ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(accountUrl).catch(() => setError('Could not open your account.'))} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#b8e986' }}>Machination account ↗</Text></Pressable> : <Text style={{ flex: 1, color: '#b4c7ca' }}>Machination account</Text>}<Pressable accessibilityRole="button" onPress={() => void signOut().catch(() => setError('Sign-out could not complete. Try again.'))} style={{ padding: 12 }}><Text style={{ color: '#b4c7ca' }}>Sign out</Text></Pressable></View>{!!error && <Text accessibilityRole="alert" style={{ color: '#ffbb91', paddingHorizontal: 16 }}>{error}</Text>}<React.Fragment key={account.accountId}>{children(account)}</React.Fragment></View>;
}
