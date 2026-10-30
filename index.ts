import React from 'react';
import { registerRootComponent } from 'expo';
import App from './App';
import { AccountProvider } from './src/online/MultiplayerAccount';
import { AppRecovery } from './src/components/AppRecovery';

registerRootComponent(() => React.createElement(AppRecovery, null, React.createElement(AccountProvider, null, React.createElement(App))));
