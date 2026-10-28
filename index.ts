import React from 'react';
import { registerRootComponent } from 'expo';
import App from './App';
import { AccountProvider } from './src/online/MultiplayerAccount';

registerRootComponent(() => React.createElement(AccountProvider, null, React.createElement(App)));
