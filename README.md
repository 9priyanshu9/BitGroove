# BitGroove

A music player with online discovery, a local library, and a responsive interface for phones, tablets, and desktops.

## Run on this computer

Double-click **start.bat**, or run:

```powershell
python server.py
```

Open **http://localhost:3000**. Python uses the standard library and needs no package installation. Stop the server with Ctrl+C.

## Deploy online for free

BitGroove can be deployed to Vercel's free Hobby plan using the existing Node.js Express backend. Import this GitHub repository at [vercel.com/new](https://vercel.com/new), keep the root directory as `./`, and deploy. No card is required for the Hobby plan. Vercel's functions have usage and duration limits; when limits are reached, requests may pause until they reset. Audio is streamed through a function, so this is best for personal use rather than high traffic.

The deployment serves `public` as static files and uses `api/index.js` as one Node function. An explicit rewrite covers every `/api/*` path, including nested search, collection, recommendations, and YouTube routes. The function restores the requested API path before Express handles it, preserving query parameters. Keep `vercel.json` in the repository root; it overrides framework detection for this setup. After deployment, `/api/health` must return JSON, and `/api/yt/audio/bad` must return JSON with HTTP 400. A Vercel `NOT_FOUND` page for the latter means the nested API requests are not reaching the application. Use the project's Production domain for a public playback check; preview URLs may require Vercel authentication.

For the Node.js server:

```powershell
npm install
node server.js
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
- YouTube: listening defaults to audio with no visible video. Direct audio streams use AAC when available. If YouTube rejects or stalls a direct stream, a hidden YouTube player continues at the same position, controlled by BitGroove's play/pause, seeking, volume, queue, and sleep timer. The **Video** button beside Play shows or hides the picture without restarting playback. The hidden-player fallback still receives video data; it does not extract or transcode audio. If the browser blocks autoplay, press BitGroove's Play button.
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
