# Echo

<p align="center">
  <img src="assets/images/echo-monochrome.png" alt="Echo" width="96" />
</p>

<p align="center"><strong>A fullscreen Android now-playing skin for Poweramp and compatible media players.</strong></p>

Echo turns whatever is playing into a focused visual dashboard. It shows the music; it does not collect it, download it, or ask it to fill out a form.

## What it includes

- Poweramp API and notification/media-session connections
- Artwork, metadata, queue context, progress, and playback controls
- Swipeable cover flow with landscape-first layouts
- Dark, light, and system themes
- Optional emulator media-session fixture for testing

## Requirements

- Android device or emulator
- Current minimum Android version: Android 7.0 (API 24)
- Android 5.0/5.1 support (API 21/22) is actively being investigated and is not supported yet
- Node.js 22+
- Java 17
- Android SDK 36
- Poweramp or a compatible media player

## Run it

```bash
npm ci
npm run android
```

For JavaScript-only changes, use npm start. Echo requires a custom development build; Expo Go is not invited.

## Check it

```bash
npm run typecheck
npm run lint
npm test
```

## License

[MIT License](LICENSE). Keep the music playing and the notification access intentional.
