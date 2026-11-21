/**
 * BitGroove Music Player - Node.js Express Server
 * Direct JioSaavn API Engine with built-in DES-ECB Decryption & Multi-Source Fallback
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    next();
});

// JioSaavn DES Key for media URL decryption
const JIO_DES_KEY = Buffer.from('38346591', 'utf-8');

function decryptMediaUrl(encryptedMediaUrl) {
    if (!encryptedMediaUrl || typeof encryptedMediaUrl !== 'string') return '';
    try {
        // Repeating the key in 3DES is equivalent to DES and works with modern OpenSSL.
        const decipher = crypto.createDecipheriv('des-ede3', Buffer.concat([JIO_DES_KEY, JIO_DES_KEY, JIO_DES_KEY]), null);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(encryptedMediaUrl.trim(), 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        decrypted = decrypted.replace(/^http:\/\//, 'https://');
        return isAllowedMediaUrl(decrypted) ? decrypted : '';
    } catch (e) {
        return '';
    }
}

function isAllowedMediaUrl(value) {
    try {
        if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) return false;
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443') &&
            (['audio-ssl.itunes.apple.com', 'jiotunepreview.jio.com'].includes(host) ||
                ['saavncdn.com', 'mzstatic.com', 'dzcdn.net', 'audius.co', 'googlevideo.com'].some(suffix => host === suffix || host.endsWith('.' + suffix)));
    } catch { return false; }
}

function decodeText(value) {
    return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function artworkImages(value) {
    if (Array.isArray(value)) value = [...value].reverse().find(item => item?.link || item?.url)?.link || [...value].reverse().find(item => item?.url)?.url || '';
    return [{ quality: '500x500', link: typeof value === 'string' ? value.replace(/\d+x\d+/, '500x500') : '' }];
}

function formatSongPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const info = raw.more_info && typeof raw.more_info === 'object' ? raw.more_info : {};
    const decryptedUrl = decryptMediaUrl(info.encrypted_media_url || raw.encrypted_media_url);
    const downloadUrl = [];
    if (decryptedUrl) {
        const url = new URL(decryptedUrl);
        const ext = url.pathname.match(/\.[a-zA-Z0-9]+$/)?.[0] || '.mp4';
        const base = url.pathname.replace(/\.[a-zA-Z0-9]+$/, '').replace(/_[0-9]+$/, '');
        const qualities = ['12', '48', '96', '160'];
        if ([true, 'true'].includes(info['320kbps'] ?? raw['320kbps'] ?? 'true')) qualities.push('320');
        for (const quality of qualities) {
            url.pathname = `${base}_${quality}${ext}`;
            downloadUrl.push({ quality: `${quality}kbps`, link: url.toString() });
        }
    } else {
        const preview = info.vlink || raw.media_preview_url;
        if (isAllowedMediaUrl(preview)) downloadUrl.push({ quality: 'preview', link: preview });
    }
    const originalDuration = Math.max(0, Number(info.duration || raw.duration) || 0);
    const isPreview = !!downloadUrl.length && !decryptedUrl;
    const primary = info.artistMap?.primary_artists?.map(artist => artist.name).filter(Boolean).join(', ') ||
        info.music || raw.primary_artists || raw.singers || raw.music || (raw.subtitle || '').split(' - ')[0] || '';
    return { id: String(raw.id || ''), name: decodeText(raw.song || raw.title || raw.name),
        album: { id: String(info.album_id || raw.albumid || ''), name: decodeText(info.album || raw.album) },
        year: raw.year || String(info.release_date || '').slice(0, 4), duration: isPreview ? 30 : originalDuration, originalDuration,
        primaryArtists: decodeText(primary), language: decodeText(raw.language || info.language), image: artworkImages(raw.image), downloadUrl, isPreview, source: 'jiosaavn',
        hasLyrics: [true, 'true'].includes(info.has_lyrics || raw.has_lyrics) };
}

async function fetchJson(url, timeout = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.jiosaavn.com/' } });
        return response.ok ? await response.json() : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
}

// Helper to query official JioSaavn API directly
async function queryJioSaavn(endpointCall, extraParams = {}, timeout = 3000) {
    const params = new URLSearchParams({
        __call: endpointCall,
        _format: 'json',
        _marker: '0',
        api_version: '4',
        ctx: 'web6dot0',
        ...extraParams
    });

    const url = `https://www.jiosaavn.com/api.php?${params.toString()}`;
    return fetchJson(url, timeout);
}

function records(payload, ...keys) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object') for (const key of keys) {
        const value = payload[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const result = records(value, 'data', 'list', 'songs', 'results');
            if (result.length) return result;
        }
    }
    return [];
}

function formatItunesTrack(item) {
    if (!item?.trackId || !isAllowedMediaUrl(item.previewUrl)) return null;
    return { id: `itunes-${item.trackId}`, name: decodeText(item.trackName), primaryArtists: decodeText(item.artistName),
        album: { id: item.collectionId ? `itunes-album-${item.collectionId}` : '', name: decodeText(item.collectionName) }, year: (item.releaseDate || '').slice(0, 4),
        duration: 30, originalDuration: Math.round((item.trackTimeMillis || 0) / 1000), isPreview: true, source: 'itunes',
        image: artworkImages((item.artworkUrl100 || '').replace('100x100bb', '600x600bb')),
        downloadUrl: [{ quality: 'preview', link: item.previewUrl }], hasLyrics: false };
}

function formatDeezerTrack(track) {
    if (!track?.id || !isAllowedMediaUrl(track.preview)) return null;
    return { id: `deezer-${track.id}`, name: decodeText(track.title), primaryArtists: decodeText(track.artist?.name),
        album: { id: track.album?.id ? `deezer-album-${track.album.id}` : '', name: decodeText(track.album?.title) }, year: '', duration: 30,
        originalDuration: Number(track.duration) || 0, isPreview: true, source: 'deezer',
        image: artworkImages(track.album?.cover_xl || track.album?.cover_big || track.album?.cover_medium),
        downloadUrl: [{ quality: 'preview', link: track.preview }], hasLyrics: false };
}

function formatAudiusTrack(track) {
    if (!track?.id || track.is_streamable === false) return null;
    return { id: `audius-${track.id}`, name: decodeText(track.title), primaryArtists: decodeText(track.user?.name),
        album: { name: 'Audius' }, year: (track.release_date || '').slice(0, 4), duration: Number(track.duration) || 0,
        isPreview: false, source: 'audius', image: artworkImages(track.artwork?.['480x480'] || track.artwork?.['150x150']),
        downloadUrl: [{ quality: 'stream', link: `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(track.id)}/stream?app_name=BitGroove` }], hasLyrics: false };
}

function playableRecords(payload, formatter = formatSongPayload) {
    const seen = new Set();
    return records(payload, 'songs', 'list', 'results', 'data').flatMap(raw => {
        try {
            const song = formatter(raw);
            if (!song?.id || !song.downloadUrl?.length || seen.has(song.id)) return [];
            seen.add(song.id);
            return [song];
        } catch { return []; }
    });
}

const searchCache = new Map();
const discoveryCache = new Map();
const collectionCache = new Map();
function cachePut(cache, key, value) {
    cache.delete(key);
    cache.set(key, { at: Date.now(), value });
    while (cache.size > 128) cache.delete(cache.keys().next().value);
}

async function searchSongs(query, page = 0, limit = 30) {
    query = String(query || '').trim();
    if (!query) return [];
    const key = `${query.toLowerCase()}:${page}:${limit}`;
    const cached = searchCache.get(key);
    if (cached && Date.now() - cached.at < 300000) return cached.value;
    const providers = [
        [() => queryJioSaavn('search.getResults', { q: query, p: String(page + 1), n: String(limit) }), formatSongPayload],
        [() => fetchJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: 'song', limit })}`), formatItunesTrack],
        [() => fetchJson(`https://api.deezer.com/search?${new URLSearchParams({ q: query, limit, index: page * limit })}`), formatDeezerTrack],
        [() => fetchJson(`https://discoveryprovider.audius.co/v1/tracks/search?${new URLSearchParams({ query, limit, offset: page * limit, app_name: 'BitGroove' })}`), formatAudiusTrack]
    ];
    for (const [load, formatter] of providers) {
        const songs = playableRecords(await load(), formatter).slice(0, limit);
        if (songs.length) { cachePut(searchCache, key, songs); return songs; }
    }
    return [];
}

function formatCollection(raw, kind = 'playlist', source = 'jiosaavn') {
    if (!raw?.id) return null;
    const info = raw.more_info || {};
    const name = decodeText(raw.title || raw.name || raw.album);
    if (!name) return null;
    return { id: source === 'jiosaavn' ? String(raw.id) : `${source}-${kind}-${raw.id}`, name,
        artist: decodeText(raw.primary_artists || raw.music || raw.subtitle || raw.artist?.name || (typeof raw.artist === 'string' ? raw.artist : '')),
        year: String(raw.year || raw.release_date || '').slice(0, 4), releaseDate: raw.release_date || info.release_date || '',
        description: decodeText(raw.description || info.description), source, type: kind,
        image: artworkImages(raw.image || raw.picture_xl || raw.cover_xl || raw.cover_big),
        songCount: Number(info.song_count || raw.song_count || raw.nb_tracks) || 0 };
}

function mergeCards(...groups) {
    const seen = new Set();
    return groups.flat().filter(card => card && !seen.has(card.id) && seen.add(card.id));
}

async function discoverySongs(query, limit = 24, timeout = 3000) {
    const sources = await Promise.all([
        queryJioSaavn('search.getResults', { q: query, p: '1', n: String(limit) }, timeout),
        fetchJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: 'song', limit })}`, timeout),
        fetchJson(`https://api.deezer.com/search?${new URLSearchParams({ q: query, limit })}`, timeout)
    ]);
    for (const [index, formatter] of [formatSongPayload, formatItunesTrack, formatDeezerTrack].entries()) {
        const songs = playableRecords(sources[index], formatter);
        if (songs.length) return songs.slice(0, limit);
    }
    return [];
}

async function playlistSearch(query) {
    return records(await queryJioSaavn('search.getPlaylistResults', { q: query, p: '1', n: '8' }), 'results').map(raw => formatCollection(raw)).filter(Boolean);
}

async function getModules(languages = 'hindi,english') {
    languages = String(languages).split(',').map(part => part.trim().toLowerCase()).filter(part => /^[a-z]+$/.test(part)).join(',') || 'hindi,english';
    const cached = discoveryCache.get(languages);
    if (cached && Date.now() - cached.at < 600000) return cached.value;
    async function loadHome() {
        const result = { trending: [], albums: [], charts: [], playlists: [] };
        for (const endpoint of ['webapi.getLaunchData', 'content.getHomepageData']) {
            const data = await queryJioSaavn(endpoint, { languages }) || {};
            if (!result.trending.length) result.trending = playableRecords(data.new_trending || data.trending || []);
            for (const [key, names, kind] of [['albums', ['new_albums', 'new_releases'], 'album'], ['charts', ['charts'], 'playlist'], ['playlists', ['top_playlists', 'featured_playlists', 'playlists'], 'playlist']]) {
                result[key] = mergeCards(result[key], names.flatMap(name => records(data[name], 'data', 'list', 'results')).filter(raw => key !== 'albums' || raw?.type !== 'song').map(raw => formatCollection(raw, kind)));
            }
            if (Object.values(result).every(value => value.length)) break;
        }
        return result;
    }
    const [home, deezer, releases] = await Promise.all([loadHome(), fetchJson('https://api.deezer.com/chart/0'), fetchJson('https://api.deezer.com/editorial/0/releases?limit=16')]);
    const chartSongs = playableRecords(deezer?.tracks, formatDeezerTrack);
    const values = { trending: home.trending.length ? home.trending : chartSongs,
        albums: mergeCards(home.albums, records(releases, 'data').map(raw => formatCollection(raw, 'album', 'deezer'))).slice(0, 16), charts: home.charts,
        playlists: mergeCards(home.playlists, records(deezer?.playlists, 'data').map(raw => formatCollection(raw, 'playlist', 'deezer'))).slice(0, 12) };
    if (!values.charts.length && chartSongs.length) values.charts = [{ id: 'deezer-chart-global', name: 'Deezer Top Tracks',
        description: 'The current global chart on Deezer. 30-second previews.', image: chartSongs[0].image, source: 'deezer', type: 'playlist', songs: chartSongs, songCount: chartSongs.length }];
    const fallbacks = {
        trending: () => discoverySongs(languages.includes('hindi') ? 'Hindi hits' : 'Pop hits', 24),
        albums: async () => {
            const data = await fetchJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: languages.includes('hindi') ? 'hindi music' : 'new music', entity: 'album', limit: 50 })}`);
            const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
            return records(data, 'results').filter(raw => raw?.collectionId && (raw.releaseDate || '').slice(0, 10) >= cutoff)
                .map(raw => ({ id: `itunes-album-${raw.collectionId}`, name: decodeText(raw.collectionName), artist: decodeText(raw.artistName),
                    year: (raw.releaseDate || '').slice(0, 4), releaseDate: raw.releaseDate || '', source: 'itunes', type: 'album',
                    image: artworkImages((raw.artworkUrl100 || '').replace('100x100bb', '600x600bb')) }))
                .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, 16);
        },
        charts: () => playlistSearch('Top 50'),
        playlists: async () => {
            const cards = await playlistSearch(languages.includes('hindi') ? 'Hindi hits' : 'Chill');
            if (cards.length) return cards;
            const songs = await discoverySongs('acoustic chill', 16);
            return songs.length ? [{ id: 'bitgroove-mix-acoustic', name: 'Acoustic Moments', description: 'A BitGroove listening mix for a quieter moment.',
                source: 'bitgroove', type: 'playlist', image: songs[0].image, songs, songCount: songs.length }] : [];
        }
    };
    await Promise.all(Object.keys(values).filter(key => !values[key].length).map(async key => { values[key] = await fallbacks[key](); }));
    const result = { trending: { songs: values.trending }, albums: values.albums, charts: values.charts, playlists: values.playlists,
        featuredPlaylists: values.playlists, availability: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, !!value.length])) };
    for (const card of [...values.albums, ...values.charts, ...values.playlists]) cachePut(collectionCache, card.id, card);
    if (Object.values(values).every(value => value.length)) cachePut(discoveryCache, languages, result);
    return result;
}

async function getCollectionDetails(id, kind) {
    const cached = collectionCache.get(id);
    if (cached && Date.now() - cached.at < 1800000 && cached.value.songs?.length) return cached.value;
    if (id === 'deezer-chart-global') {
        const songs = playableRecords(await fetchJson('https://api.deezer.com/chart/0/tracks?limit=50'), formatDeezerTrack);
        return songs.length ? { id, name: 'Deezer Top Tracks', image: songs[0].image, source: 'deezer', type: 'playlist', songs } : null;
    }
    const prefix = `deezer-${kind}-`;
    if (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) {
        const raw = await fetchJson(`https://api.deezer.com/${kind}/${id.slice(prefix.length)}`);
        const card = formatCollection(raw, kind, 'deezer');
        if (!card) return null;
        card.songs = playableRecords(raw.tracks, formatDeezerTrack);
        if (kind === 'album') for (const song of card.songs) {
            song.album = { id, name: card.name };
            if (!song.image.some(item => item.link)) song.image = card.image;
        }
        return card.songs.length ? card : null;
    }
    const itunesId = id.startsWith('itunes-album-') ? id.slice(13) : id;
    if (!id.startsWith('itunes-')) {
        const raw = await queryJioSaavn(kind === 'album' ? 'content.getAlbumDetails' : 'playlist.getDetails', kind === 'album' ? { albumid: id } : { listid: id, n: '100' });
        const card = formatCollection(raw, kind);
        const songs = playableRecords(raw);
        if (card && songs.length) return { ...card, songs };
    }
    if (kind === 'album' && /^\d+$/.test(itunesId)) {
        const items = records(await fetchJson(`https://itunes.apple.com/lookup?${new URLSearchParams({ id: itunesId, entity: 'song' })}`), 'results');
        const songs = playableRecords(items, formatItunesTrack);
        if (songs.length) return { id, name: decodeText(items[0].collectionName), artist: decodeText(items[0].artistName), source: 'itunes', type: 'album',
            year: (items[0].releaseDate || '').slice(0, 4), image: artworkImages((items[0].artworkUrl100 || '').replace('100x100bb', '600x600bb')), songs };
    }
    return null;
}

async function getSongSuggestions(id, artist = '', name = '', language = '', limit = 12, exclude = null) {
    const excluded = Array.isArray(exclude) ? exclude.slice(0, 100).filter(value => typeof value === 'string') : [];
    const seen = new Set([id, ...excluded]);
    const result = [];
    function accept(songs) {
        for (const song of songs) {
            const identity = `${song.name.toLowerCase()}|${song.primaryArtists.toLowerCase()}`;
            if (seen.has(song.id) || seen.has(identity) || (name && song.name.toLowerCase() === name.toLowerCase())) continue;
            seen.add(song.id); seen.add(identity); result.push(song);
            if (result.length >= limit) break;
        }
        return !!result.length;
    }
    const candidates = Math.min(100, Math.max(limit * 3, limit + excluded.length));
    if (!/^(itunes-|deezer-|audius-|yt-|curated-)/.test(id)) {
        const station = await queryJioSaavn('webradio.createEntityStation', { entity_id: JSON.stringify([id]), entity_type: 'queue' });
        if (station?.stationid) {
            const radio = await queryJioSaavn('webradio.getSong', { stationid: station.stationid, k: String(Math.min(50, candidates)), next: '1' });
            if (accept(playableRecords(Object.values(radio || {}).flatMap(item => item?.song ? [item.song] : [])))) return result;
        }
    }
    // The extra discovery fallback fits inside the client's 12s timeout.
    const discover = query => discoverySongs(query, candidates, exclude === null ? 3000 : 2000);
    const query = artist.split(',')[0].trim() || name.trim();
    if (query && accept(await discover(query))) return result;
    language = language.split(',')[0].trim().toLowerCase();
    const broadQuery = /^[a-z]+$/.test(language) && language !== 'english' ? `${language} songs` : 'pop hits';
    if (broadQuery.toLowerCase() !== query.toLowerCase()) accept(await discover(broadQuery));
    return result;
}

app.use('/api', (req, res, next) => {
    const limit = Number(req.query.limit ?? 30), page = Number(req.query.page ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(page) || page < 0 || page > 1000)
        return res.status(400).json({ success: false, error: 'limit must be 1-100 and page must be 0-1000' });
    next();
});

app.get('/api/health', (req, res) => res.json({ success: true, data: { name: 'BitGroove', runtime: 'node', sources: ['jiosaavn', 'itunes', 'deezer', 'audius', 'youtube'] } }));

app.get('/api/stream', async (req, res) => {
    let url = req.query.url;
    if (!isAllowedMediaUrl(url)) return res.status(400).json({ success: false, error: 'Unsupported media URL' });
    const range = req.headers.range;
    if (range && (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-')) return res.status(400).json({ success: false, error: 'Invalid range' });
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), 8000);
    const close = () => { clearTimeout(timer); controller.abort(); };
    res.on('close', close);
    try {
        let upstream;
        for (let count = 0; count < 5; count++) {
            const upstreamRange = req.method === 'HEAD' ? range : youtubeMediaRange(url, range);
            upstream = await fetch(url, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', redirect: 'manual', signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity', ...(upstreamRange ? { Range: upstreamRange } : {}) } });
            if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
            const target = new URL(upstream.headers.get('location') || '', url).toString();
            if (!isAllowedMediaUrl(target)) throw new Error('Unsupported media redirect');
            await upstream.body?.cancel(); url = target;
        }
        clearTimeout(timer);
        if (upstream.status === 416) {
            if (upstream.headers.get('content-range')) res.setHeader('Content-Range', upstream.headers.get('content-range'));
            return res.status(416).end();
        }
        const type = upstream.headers.get('content-type') || 'application/octet-stream';
        if (![200, 206].includes(upstream.status) || !(type.startsWith('audio/') || ['video/mp4', 'application/octet-stream', 'binary/octet-stream'].includes(type.split(';')[0])))
            throw new Error('Music source unavailable');
        res.status(upstream.status);
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'private, max-age=300');
        for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges']) if (upstream.headers.get(header)) res.setHeader(header, upstream.headers.get(header));
        if (req.method === 'HEAD') return res.end();
        Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    } catch {
        if (!res.headersSent) res.status(502).json({ success: false, error: 'Music source is unavailable' });
    } finally { clearTimeout(timer); }
});

app.get('/api/songs/:id/suggestions', async (req, res) => {
    let excluded = null;
    if (req.query.exclude !== undefined) {
        try {
            excluded = JSON.parse(req.query.exclude);
            if (!Array.isArray(excluded) || excluded.length > 100 || excluded.some(value => typeof value !== 'string' || value.length > 200)) throw new Error();
        } catch { return res.status(400).json({ success: false, error: 'exclude must be a JSON array of up to 100 song IDs' }); }
    }
    const results = await getSongSuggestions(req.params.id, String(req.query.artist || ''), String(req.query.name || req.query.title || ''), String(req.query.language || ''), Number(req.query.limit || 12), excluded);
    res.json({ success: true, data: { results } });
});

// ============ SEARCH SONGS ============
app.get('/api/search/songs', async (req, res) => {
    const results = await searchSongs(req.query.query || req.query.q || '', Number(req.query.page || 0), Number(req.query.limit || 30));
    res.json({ success: true, data: { results } });
});

// ============ SEARCH ALBUMS ============
app.get('/api/search/albums', async (req, res) => {
    const query = req.query.query || '';
    const page = parseInt(req.query.page || '0', 10) + 1;
    const limit = parseInt(req.query.limit || '20', 10);

    try {
        const jioData = await queryJioSaavn('search.getAlbumResults', {
            q: query,
            p: page.toString(),
            n: limit.toString()
        });

        const results = (jioData?.results || []).map(a => ({
            id: a.id,
            name: a.album || a.title || a.name,
            artist: a.music || a.primary_artists || a.artist || '',
            year: a.year || '',
            image: [{ quality: '500x500', link: (a.image || '').replace(/150x150|50x50/, '500x500') }]
        }));

        res.json({ success: true, data: { results } });
    } catch (e) {
        res.json({ success: true, data: { results: [] } });
    }
});

// ============ SEARCH ARTISTS ============
app.get('/api/search/artists', async (req, res) => {
    const query = req.query.query || '';
    const page = parseInt(req.query.page || '0', 10) + 1;
    const limit = parseInt(req.query.limit || '20', 10);

    try {
        const jioData = await queryJioSaavn('search.getArtistResults', {
            q: query,
            p: page.toString(),
            n: limit.toString()
        });

        const results = (jioData?.results || []).map(a => ({
            id: a.id,
            name: a.name || a.artist || '',
            image: [{ quality: '500x500', link: (a.image || '').replace(/150x150|50x50/, '500x500') }]
        }));

        res.json({ success: true, data: { results } });
    } catch (e) {
        res.json({ success: true, data: { results: [] } });
    }
});

// ============ SEARCH PLAYLISTS ============
app.get('/api/search/playlists', async (req, res) => {
    const query = req.query.query || '';
    const page = parseInt(req.query.page || '0', 10) + 1;
    const limit = parseInt(req.query.limit || '20', 10);

    try {
        const jioData = await queryJioSaavn('search.getPlaylistResults', {
            q: query,
            p: page.toString(),
            n: limit.toString()
        });

        const results = (jioData?.results || []).map(p => ({
            id: p.id,
            name: p.title || p.name || '',
            songCount: p.more_info?.song_count || p.song_count || '',
            image: [{ quality: '500x500', link: (p.image || '').replace(/150x150|50x50/, '500x500') }]
        }));

        res.json({ success: true, data: { results } });
    } catch (e) {
        res.json({ success: true, data: { results: [] } });
    }
});

// ============ SONG DETAILS ============
app.get('/api/songs/:id', async (req, res) => {
    const id = req.params.id;
    let song;
    if (/^itunes-\d+$/.test(id)) song = playableRecords(await fetchJson('https://itunes.apple.com/lookup?id=' + id.slice(7)), formatItunesTrack)[0];
    else if (/^deezer-\d+$/.test(id)) song = formatDeezerTrack(await fetchJson('https://api.deezer.com/track/' + id.slice(7)));
    else if (id.startsWith('audius-')) song = formatAudiusTrack((await fetchJson('https://discoveryprovider.audius.co/v1/tracks/' + encodeURIComponent(id.slice(7)) + '?app_name=BitGroove'))?.data);
    else {
        const data = await queryJioSaavn('song.getDetails', { pids: id });
        song = playableRecords(data)[0] || formatSongPayload(data?.[id]);
    }
    return song?.id ? res.json({ success: true, data: song }) : res.status(404).json({ success: false, error: 'Song unavailable' });
});

// ============ SONG LYRICS ============
app.get('/api/songs/:id/lyrics', async (req, res) => {
    const id = req.params.id;
    try {
        const jioData = await queryJioSaavn('lyrics.getLyrics', { lyrics_id: id });
        if (jioData && jioData.lyrics) {
            return res.json({ success: true, data: { lyrics: jioData.lyrics } });
        }
        res.json({ success: true, data: { lyrics: null } });
    } catch (e) {
        res.json({ success: true, data: { lyrics: null } });
    }
});

// ============ ALBUM DETAILS ============
app.get('/api/albums', async (req, res) => {
    if (!req.query.id) return res.status(400).json({ success: false, error: 'Album ID required' });
    const data = await getCollectionDetails(String(req.query.id), 'album');
    return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: 'Album unavailable' });
});

app.get('/api/playlists', async (req, res) => {
    if (!req.query.id) return res.status(400).json({ success: false, error: 'Playlist ID required' });
    const data = await getCollectionDetails(String(req.query.id), 'playlist');
    return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, error: 'Playlist unavailable' });
});

app.get('/api/modules', async (req, res) => {
    const data = await getModules(req.query.languages || req.query.language || 'hindi,english');
    res.json({ success: true, data });
});

// ============ DEEZER SEARCH (Spotify-equivalent: worldwide, free, 30s previews) ============
app.get('/api/deezer/search', async (req, res) => {
    const data = await fetchJson(`https://api.deezer.com/search?${new URLSearchParams({ q: req.query.q || '', limit: req.query.limit || 30 })}`);
    res.json({ success: true, data: { results: playableRecords(data, formatDeezerTrack) } });
});

app.get('/api/deezer/charts', async (req, res) => {
    const data = await fetchJson('https://api.deezer.com/chart/0/tracks?limit=50');
    res.json({ success: true, data: { results: playableRecords(data, formatDeezerTrack) } });
});

// ============ YOUTUBE SEARCH via YouTube InnerTube ============
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.leptons.xyz',
    'https://api.piped.yt'
];

const YOUTUBE_PLAYER_CLIENTS = [
    {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 35,
        userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 15; en_US; sdk_gphone64_x86_64 Build/AP3A.241005.015.A2) gzip'
    },
    {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.0.0.22A3354'
    }
];

function isAllowedYouTubeAudioUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')) &&
            !url.username && !url.password && (!url.port || url.port === '443');
    } catch {
        return false;
    }
}

function youtubeMediaRange(value, range) {
    if (!isAllowedYouTubeAudioUrl(value)) return range;
    const chunkSize = 256 * 1024;
    const length = Math.max(0, Number(new URL(value).searchParams.get('clen')) || 0);
    const match = /^bytes=(\d*)-(\d*)$/.exec(range || 'bytes=0-');
    if (!match) return range;
    let start, end;
    if (!match[1]) {
        if (!length) return range;
        start = Math.max(0, length - Number(match[2]));
        end = length - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : start + chunkSize - 1;
    }
    end = Math.min(end, start + chunkSize - 1);
    if (length && start < length) end = Math.min(end, length - 1);
    return `bytes=${start}-${end}`;
}

function compareYouTubeAudio(a, b) {
    const aac = stream => Boolean(stream.mimeType?.startsWith('audio/mp4') &&
        (!stream.mimeType.includes('codecs=') || stream.mimeType.includes('mp4a')));
    return Number(aac(b)) - Number(aac(a)) ||
        (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0);
}

async function resolveInnerTubeAudioStream(videoId) {
    for (const client of YOUTUBE_PLAYER_CLIENTS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Origin': 'https://www.youtube.com',
                    'Referer': 'https://www.youtube.com/'
                },
                body: JSON.stringify({
                    context: { client: { ...client, hl: 'en', gl: 'US' } },
                    videoId,
                    contentCheckOk: true,
                    racyCheckOk: true
                }),
                signal: controller.signal
            });
            if (!response.ok) continue;
            const payload = await response.json();
            if (payload.playabilityStatus?.status !== 'OK') continue;
            const audioStreams = (payload.streamingData?.adaptiveFormats || [])
                .filter(stream => stream.mimeType?.startsWith('audio/') && isAllowedYouTubeAudioUrl(stream.url))
                .sort(compareYouTubeAudio);
            if (audioStreams.length > 0) {
                return {
                    url: audioStreams[0].url,
                    bitrate: audioStreams[0].averageBitrate || audioStreams[0].bitrate || 0,
                    mimeType: audioStreams[0].mimeType
                };
            }
        } catch (error) {
            console.warn(`YouTube player ${client.clientName} failed: ${error.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
    return null;
}

async function resolvePipedAudioStream(videoId) {
    for (const base of PIPED_INSTANCES) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(`${base}/streams/${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: controller.signal
            });
            if (!response.ok) continue;
            const json = await response.json();
            const audioStreams = (json.audioStreams || [])
                .filter(stream => stream.url && !stream.videoOnly && isAllowedYouTubeAudioUrl(stream.url))
                .sort(compareYouTubeAudio);
            if (audioStreams.length > 0) {
                return {
                    url: audioStreams[0].url,
                    bitrate: audioStreams[0].bitrate,
                    mimeType: audioStreams[0].mimeType || 'audio/webm'
                };
            }
        } catch (error) {
            console.warn(`Piped stream ${base} failed: ${error.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
    return null;
}

async function resolveYouTubeAudioStream(videoId) {
    return await resolveInnerTubeAudioStream(videoId) || await resolvePipedAudioStream(videoId);
}

app.get('/api/yt/search', async (req, res) => {
    const q = req.query.q || '';
    if (!q.trim()) return res.json({ success: true, data: { results: [] } });
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 25));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com/'
            },
            body: JSON.stringify({
                context: { client: { clientName: 'WEB', clientVersion: '2.20240101.01.00' } },
                query: String(q).trim()
            }),
            signal: controller.signal
        });
        if (!response.ok) return res.status(502).json({ success: false, error: 'YouTube search is temporarily unavailable' });

        const payload = await response.json();
        const sections = payload.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const results = [];
        for (const section of sections) {
            for (const item of section.itemSectionRenderer?.contents || []) {
                const video = item.videoRenderer;
                const ytId = video?.videoId;
                const title = video?.title?.runs?.map(run => run.text || '').join('') || video?.title?.simpleText || '';
                if (!ytId || !title || !/^[A-Za-z0-9_-]{11}$/.test(ytId)) continue;

                const durationText = video.lengthText?.simpleText || '';
                const durationParts = durationText.split(':').map(Number);
                const duration = durationParts.length > 0 && durationParts.every(Number.isFinite)
                    ? durationParts.reduce((total, part) => total * 60 + part, 0)
                    : 0;
                const owner = video.ownerText?.runs?.map(run => run.text || '').join('') || 'YouTube';
                const thumbnails = video.thumbnail?.thumbnails || [];
                results.push({
                    id: `yt-${ytId}`,
                    ytId,
                    name: title,
                    primaryArtists: owner,
                    album: { name: 'YouTube Music' },
                    year: '',
                    duration,
                    durationText,
                    image: [{ quality: '500x500', link: thumbnails.at(-1)?.url || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` }],
                    downloadUrl: [],
                    hasLyrics: false,
                    source: 'youtube',
                    isPreview: false
                });
                if (results.length >= limit) break;
            }
            if (results.length >= limit) break;
        }
        return res.json({ success: true, data: { results } });
    } catch (error) {
        console.warn(`YouTube InnerTube search failed: ${error.message}`);
        return res.status(502).json({ success: false, error: 'YouTube search is temporarily unavailable' });
    } finally {
        clearTimeout(timer);
    }
});

// ============ YOUTUBE AUDIO STREAM ============
app.get('/api/yt/audio/:videoId', async (req, res) => {
    const { videoId } = req.params;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ success: false, error: 'Invalid YouTube video ID' });
    const stream = await resolveYouTubeAudioStream(videoId);
    if (!stream) return res.status(502).json({ success: false, error: 'Could not resolve YouTube audio' });
    res.set('Cache-Control', 'no-store').redirect(302, `/api/stream?url=${encodeURIComponent(stream.url)}`);
});

app.get('/api/yt/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ success: false, error: 'Invalid YouTube video ID' });
    const stream = await resolveYouTubeAudioStream(videoId);
    if (!stream) return res.status(502).json({ success: false, error: 'Could not resolve YouTube audio' });
    res.json({ success: true, data: stream });
});

// ============ LYRICS via lyrics.ovh (fallback for non-JioSaavn songs) ============
app.get('/api/lyrics/external', async (req, res) => {
    const { artist, title } = req.query;
    if (!artist || !title) return res.json({ success: false });
    try {
        const r = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        const json = await r.json();
        if (json.lyrics) {
            return res.json({ success: true, data: { lyrics: json.lyrics } });
        }
    } catch (e) {}
    res.json({ success: false });
});

app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'API endpoint not found' }));

// Catch-all SPA route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (typeof module !== 'undefined' && require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n  🎵 BitGroove Music Player`);
        console.log(`  ========================`);
        console.log(`  Server running at: http://localhost:${PORT}`);
        console.log(`  Sources: JioSaavn (DES) | Deezer | YouTube (Piped) | iTunes | Audius\n`);
    });
}

if (typeof module !== 'undefined') module.exports = app;
