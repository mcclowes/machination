import React from 'react';
import { SignInButton } from '@clerk/expo/web';

export function AccountSignIn() {
  return <SignInButton mode="modal"><button style={{ padding: 16, color: '#b8e986', background: '#183324', border: '1px solid #557b4b', borderRadius: 4, cursor: 'pointer' }}>Sign in or create an account</button></SignInButton>;
}
