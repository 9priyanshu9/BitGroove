# BitGroove

A music player with online discovery, a local library, and a responsive interface for phones, tablets, and desktops.

## Run on this computer

Double-click **start.bat**, or run:

```powershell
python server.py
```

Open **http://localhost:3000**. Python uses the standard library and needs no package installation. Stop the server with Ctrl+C.

For the Node.js server:

```powershell
npm install
npm start
```

## Open on a phone or tablet

Double-click **start-lan.bat** and keep the server running. Connect your phone or tablet to the same Wi-Fi as the computer. Run `ipconfig` on the computer to find its Wi-Fi IPv4 address, then open **http://YOUR-COMPUTER-IP:3000** on the other device. For example, an address of `192.168.1.25` gives `http://192.168.1.25:3000`.

If Windows asks, allow Python on your private network. The regular Python launcher uses localhost; the LAN launcher sets `BITGROOVE_HOST=0.0.0.0` to accept connections from your other devices.

The interface adapts from 320px phones to large displays, with a mobile navigation drawer, visible search, compact player, scrollable content, and safe-area spacing. Reduced-motion settings disable animations.

## Discovery and continuous playback

Home includes quick picks, trending music, new releases, charts, featured playlists, and artists to explore. Each shelf has independent provider fallbacks and a retry state. Albums and playlists open their playable track lists. Discovery data is refreshed from the providers rather than a fixed year or fabricated track list.

Playing a song displays **More like this** recommendations. **Autoplay** is enabled by default in **Up Next** and adds related songs as your queue runs low. Songs you add manually retain priority. Duplicate and already consumed songs are excluded; changing tracks, clearing the queue, or pausing cannot let an older request restart playback.

Turn Autoplay off to stop at the end of your manual queue. Repeat One and Repeat All take priority over automatic recommendations. Clearing the queue keeps the current track and suppresses automatic refill until you choose another song or enable Autoplay again.

## Music sources

- JioSaavn: full streams when the provider supplies them, with selectable quality.
- YouTube: playback through the YouTube player when embedding is available.
- iTunes and Deezer: playable catalog previews, labeled as previews with their playback duration.
- Audius: community music streams.

Provider outages and unavailable songs show a status message. Autoplay requires fresh playable results from a provider; it cannot continue while every music source is unavailable.

## Library and listening controls

Favorites, playlists, listening history, downloads, theme preferences, and audio settings are saved in the browser on each device. Listening controls include shuffle, repeat, volume, a ten-band equalizer, a sleep timer, lyrics when available, and a fullscreen player.

Keyboard shortcuts: Space for play/pause; Left/Right to seek; Up/Down for volume; N/P for next/previous; M to mute; L to favorite; S for shuffle; R for repeat; F for fullscreen; Escape to close panels. Cards also support Enter and Space.

## Verification

Run the frontend/player tests:

```powershell
npm test
```

Run backend tests, including dependency-free checks of the Node helpers:

```powershell
npm run test:backend
```

These tests verify queue transitions, stale-request handling, discovery routes and fallbacks, collection details, provider metadata, and media range forwarding. They use controlled provider responses and do not establish current live provider availability or audible browser playback.

For an optional live search and media-byte check in an environment with network access:

```powershell
python tests/probe_backend.py
```

After a server update, restart the server and hard-refresh the browser with Ctrl+F5.
