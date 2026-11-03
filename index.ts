import React from 'react';
import { registerRootComponent } from 'expo';
import App from './App';
import { AccountProvider } from './src/online/MultiplayerAccount';
import { AppRecovery } from './src/components/AppRecovery';
import { installPlatformSurface } from './src/components/install-web-surface';

installPlatformSurface();

registerRootComponent(() => React.createElement(AppRecovery, null, React.createElement(AccountProvider, null, React.createElement(App))));
