# Commands

Machination is an Expo/React Native strategy game with a local multiplayer service.
Use Node.js 24.14.1 from .nvmrc and install dependencies with npm ci before running commands.
Project documentation is in docs, Saggar's default documentation folder.

- Expo development: `npm start` - Start Metro and choose a target platform. #monitor
- iOS simulator: `npm run ios` - Generate and compile the native iOS app; requires Xcode and CocoaPods. #monitor #simulator
- Android app: `npm run android` - Generate and compile the native Android app; requires Android tooling and an emulator or device. #monitor
- Project checks: `npm run check` - Run behavior tests, TypeScript, and standalone server build/restart tests. #quick #ci
- Tests: `npm test` - Run the behavior suite without the separate production bundle tests. #quick
- Typecheck: `npm run typecheck` - Check TypeScript without emitting files. #quick
- Export web: `npm run build:web` - Export the browser app to dist. #quick
- Player guide: `npm run docs` - Start the Docusaurus guide on port 3000; first run npm ci --prefix website. #monitor #browser
- Build player guide: `npm run build:docs` - Generate the static guide in website/build. #quick
- Guide checks: `npm run check:docs` - Check site TypeScript, generate shared references, and build with strict link validation. #quick
- Guide browser checks: `npm run test:docs` - Check the production guide on desktop and phone; run build:docs first. #quick

## Layout

Open layout starts both services in the monitor dock and leaves a plain shell in the main pane.
The web app also supports solo play; connect through Multiplayer uplink to use the service.

- Web app: `npm run web` - Start Expo for the browser, normally on port 8081. #monitor #browser
- Multiplayer server: `npm run server` - Start the local service on 127.0.0.1:8787; saves games under .data. #monitor
