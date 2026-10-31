import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useAccountAccess } from '../online/MultiplayerAccount';
import { DEFAULT_GAME_SERVER, restoreSession } from '../online/client';
import type { RequestSession } from '../online/account-auth';
import { FactionPanel } from '../online/FactionPanel';

export function ProfileFaction() {
  const account = useAccountAccess();
  const [session, setSession] = useState<RequestSession | null>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (account !== null) return;
    setError(false);
    setSession(undefined);
    void restoreSession().then(value => { if (active) setSession(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [account]);
  const connection = account ? { url: DEFAULT_GAME_SERVER, token: '', ...account } : session;
  if (connection) return <FactionPanel session={connection} refreshKey="profile" onMembership={() => {}} />;
  return <Text style={{ color: '#b8c5b5', fontSize: 13 }}>{error ? 'Could not restore your faction connection. Reopen your multiplayer uplink to try again.' : account === undefined || session === undefined ? 'Loading faction connection…' : 'Open the multiplayer uplink to sign in or connect, then choose your faction here after completing your first online operation.'}</Text>;
}
