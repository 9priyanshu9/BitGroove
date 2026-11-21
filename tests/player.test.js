const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function song(id, extra = {}) {
    return {
        id, name: id, primaryArtists: 'Test Artist', album: { name: 'Test Album' },
        duration: 30, image: [],
        downloadUrl: [{ quality: '160kbps', link: `https://aac.saavncdn.com/${id}.m4a` }],
        ...extra
    };
}

function response(results) {
    return {
        ok: true, status: 200, statusText: 'OK',
        headers: { get() { return 'application/json'; } },
        async json() { return { success: true, data: { results } }; }
    };
}

async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

function harness(fetchImpl = async () => response([]), youtubeIframeApiLoaded = false) {
    let now = 0;
    let timerId = 0;
    const timers = new Map();
    const elements = new Map();
    const documentEvents = new Map();
    const warnings = [];
    const fetches = [];
    const ytPlayers = [];
    const ytCalls = [];
    const ytApi = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, CUED: 5 } };
    if (youtubeIframeApiLoaded) {
        ytApi.Player = function(target, config) {
            ytPlayers.push({ target, config });
            return {
                loadVideoById(video) { ytCalls.push({ method: 'load', video }); },
                cueVideoById(video) { ytCalls.push({ method: 'cue', video }); },
                playVideo() { ytCalls.push({ method: 'play' }); },
                pauseVideo() { ytCalls.push({ method: 'pause' }); },
                setVolume(volume) { ytCalls.push({ method: 'volume', volume }); },
                seekTo(seconds) { ytCalls.push({ method: 'seek', seconds }); },
                getCurrentTime() { return 23; },
                getDuration() { return 30; }
            };
        };
    }

    class Element {
        constructor() {
            this.style = { setProperty(name, value) { this[name] = value; } };
            this.dataset = {};
            this.value = '';
            this.textContent = '';
            this.children = [];
            this.listeners = new Map();
            this.parts = new Map();
            this._html = '';
            const classes = new Set();
            this.classList = {
                add(...values) { values.forEach(v => classes.add(v)); },
                remove(...values) { values.forEach(v => classes.delete(v)); },
                contains(value) { return classes.has(value); },
                toggle(value, force) {
                    const add = force === undefined ? !classes.has(value) : force;
                    if (add) classes.add(value); else classes.delete(value);
                    return add;
                }
            };
        }
        set innerHTML(value) {
            this._html = String(value);
            this.value = this._html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        }
        get innerHTML() { return this._html; }
        addEventListener(name, callback) {
            if (!this.listeners.has(name)) this.listeners.set(name, []);
            this.listeners.get(name).push(callback);
        }
        appendChild(child) { this.children.push(child); return child; }
        remove() {}
        setAttribute(name, value) { this[name] = String(value); }
        getAttribute(name) { return this[name] ?? null; }
        removeAttribute(name) { delete this[name]; }
        querySelectorAll() { return []; }
        querySelector(selector) {
            if ((selector.startsWith('.') && this._html.includes(selector.slice(1))) || this._html.includes(`<${selector}`)) {
                if (!this.parts.has(selector)) this.parts.set(selector, new Element());
                return this.parts.get(selector);
            }
            return null;
        }
        closest() { return null; }
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    }

    class MockAudio extends Element {
        constructor() {
            super();
            this._src = '';
            this.currentSrc = '';
            this.paused = true;
            this.ended = false;
            this.error = null;
            this.currentTime = 0;
            this.duration = 30;
            this.volume = 1;
            this.readyState = 4;
            this.networkState = 1;
            this.playCalls = 0;
            this.nextPlay = null;
        }
        set src(value) {
            this._src = String(value);
            this.currentSrc = this._src;
            this.currentTime = 0;
            this.ended = false;
        }
        get src() { return this._src; }
        getAttribute(name) { return name === 'src' ? this._src || null : super.getAttribute(name); }
        removeAttribute(name) {
            if (name === 'src') { this._src = ''; this.currentSrc = ''; }
            else super.removeAttribute(name);
        }
        load() { this.error = null; }
        play() {
            this.playCalls++;
            this.paused = false;
            this.ended = false;
            this.emit('play');
            const result = this.nextPlay;
            this.nextPlay = null;
            return result || Promise.resolve();
        }
        pause() {
            const wasPlaying = !this.paused;
            this.paused = true;
            if (wasPlaying) this.emit('pause');
        }
        emit(name) {
            if (name === 'ended') { this.paused = true; this.ended = true; }
            for (const callback of this.listeners.get(name) || []) callback({ type: name, target: this });
        }
    }

    const document = {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, new Element());
            return elements.get(id);
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return new Element(); },
        addEventListener(name, callback) {
            if (!documentEvents.has(name)) documentEvents.set(name, []);
            documentEvents.get(name).push(callback);
        },
        documentElement: new Element(), body: new Element(), activeElement: { tagName: 'BODY' }
    };
    const context = {
        document, Audio: MockAudio,
        console: { log() {}, warn(...args) { warnings.push(args); }, error(...args) { warnings.push(args); } },
        navigator: { onLine: true },
        location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000', protocol: 'http:' },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        AbortController, URL, URLSearchParams, Promise, Date, Math,
        YT: ytApi,
        setTimeout(callback, delay = 0) {
            const id = ++timerId;
            timers.set(id, { callback, at: now + Number(delay), interval: 0 });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        setInterval(callback, delay = 0) {
            const id = ++timerId;
            timers.set(id, { callback, at: now + Number(delay), interval: Math.max(1, Number(delay)) });
            return id;
        },
        clearInterval(id) { timers.delete(id); },
        requestAnimationFrame(callback) { callback(); return 1; },
        cancelAnimationFrame() {},
        fetch(url, options = {}) {
            fetches.push({ url: String(url), options });
            return fetchImpl(url, options);
        }
    };
    context.window = context;
    context.globalThis = context;
    context.window.addEventListener = () => {};
    const bridge = `
        globalThis.__player = {
            API, state, audio, playSong, togglePlay, playNext, playPrevious,
            setQueue, addNextToQueue, removeFromQueue, clearQueue, performSearch,
            addToQueue, setAutoplay, loadRelatedSongs, appendRecommendations, renderQueue,
            loadHomePage, renderChartsPage, renderAlbumDetailPage, renderPlaylistDetailPage, navigateTo, setupEventListeners, retryDiscovery,
            onYTStateChange, onYTError, setupAudioListeners, toggleYouTubeVideo,
            seekTo, setVolume, toggleMute, setSleepTimer,
            setYtPlayer(player) { ytPlayer = player; ytReady = true; }
        };
    `;
    assert.match(source, /\}\)\(\);\s*$/);
    vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `${bridge}\n})();`), context, { filename: 'public/app.js' });
    const player = context.__player;
    return {
        player, context, elements, warnings, fetches, ytPlayers, ytCalls,
        emitDocument(name, event) {
            for (const callback of documentEvents.get(name) || []) callback(event);
        },
        async advance(ms) {
            const end = now + ms;
            let count = 0;
            while (true) {
                const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                assert.ok(count++ < 1000, 'timer loop must remain bounded');
                const [id, timer] = next;
                now = timer.at;
                if (timer.interval) timer.at += timer.interval; else timers.delete(id);
                timer.callback();
                await settle();
            }
            now = end;
            await settle();
        },
        async boot() {
            for (const callback of documentEvents.get('DOMContentLoaded') || []) callback();
            await settle();
        }
    };
}

test('startup does not seed a fake music queue or selected track', async () => {
    const h = harness();
    await h.boot();
    assert.equal(h.player.state.queue.length, 0);
    assert.equal(h.player.state.currentSong, null);
});

test('Play loads the selected track when its audio source is not loaded', async () => {
    const h = harness();
    const selected = song('selected');
    h.player.state.currentSong = selected;
    h.player.state.queue = [selected];
    h.player.state.queueIndex = 0;
    h.player.togglePlay();
    await settle();
    assert.ok(h.player.audio.src.includes('selected'), 'selected stream must be assigned');
    assert.equal(h.player.audio.playCalls, 1);
    assert.equal(h.player.state.isPlaying, true);
});

test('YouTube tracks use the main audio element without loading a video iframe', async () => {
    const h = harness(undefined, true);
    const youtube = song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk', downloadUrl: [] });
    await h.player.playSong(youtube);

    assert.equal(h.player.audio.src, '/api/yt/audio/abcdefghijk');
    assert.equal(h.player.audio.playCalls, 1);
    assert.equal(h.player.state.isYtPlaying, false);
    assert.equal(h.ytPlayers.length, 0);
    assert.equal(h.elements.get('app').classList.contains('youtube-track-active'), true);
    assert.equal(h.elements.get('yt-video-btn').hidden, false);
});

test('the Video button shows and hides the picture without restarting playback', async () => {
    const h = harness(undefined, true);
    const youtube = song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk', downloadUrl: [] });
    await h.player.playSong(youtube);
    h.player.audio.currentTime = 12;

    h.player.toggleYouTubeVideo();
    assert.equal(h.player.state.isYtPlaying, true);
    assert.equal(h.player.state.isYtVideoVisible, true);
    assert.equal(h.elements.get('app').classList.contains('youtube-video-open'), true);
    assert.equal(h.ytPlayers.length, 1);
    h.ytPlayers[0].config.events.onReady();
    assert.equal(h.ytCalls[0].method, 'load');
    assert.equal(h.ytCalls[0].video.videoId, 'abcdefghijk');
    assert.equal(h.ytCalls[0].video.startSeconds, 12);
    assert.equal(h.ytCalls[1].method, 'play');

    const callsBeforeHide = h.ytCalls.length;
    h.player.toggleYouTubeVideo();
    await settle();
    assert.equal(h.player.state.isYtPlaying, true);
    assert.equal(h.player.state.isYtVideoVisible, false);
    assert.equal(h.elements.get('app').classList.contains('youtube-video-open'), false);
    assert.equal(h.ytCalls.length, callsBeforeHide, 'hiding the picture must not reload, seek, or pause');
    assert.equal(h.player.audio.playCalls, 1);
    assert.equal(h.player.state.isPlaying, true);

    await h.player.playSong(song('regular-track'));
    assert.equal(h.elements.get('app').classList.contains('youtube-track-active'), false);
    assert.equal(h.elements.get('yt-video-btn').hidden, true);
});

test('a rejected YouTube audio load falls back once without skipping the selected track', async () => {
    const h = harness(undefined, true);
    h.player.setupAudioListeners();
    const failed = deferred();
    h.player.audio.nextPlay = failed.promise;
    const youtube = song('yt-VYOjWnS4cMY', { source: 'youtube', ytId: 'VYOjWnS4cMY', downloadUrl: [] });
    h.player.state.queue = [youtube, song('next')];
    const playing = h.player.playSong(youtube);
    h.player.audio.error = { code: 4 };
    h.player.audio.emit('error');
    failed.reject(Object.assign(new Error('Unsupported stream'), { name: 'NotSupportedError' }));
    await playing;

    assert.equal(h.player.state.currentSong, youtube);
    assert.equal(h.player.state.queueIndex, 0);
    assert.equal(h.player.state.isYtPlaying, true);
    assert.equal(h.player.state.isYtVideoVisible, false);
    assert.equal(h.elements.get('app').classList.contains('youtube-video-open'), false);
    assert.equal(h.elements.get('yt-player-host').getAttribute('aria-hidden'), 'true');
    assert.equal(h.elements.get('yt-player-host').getAttribute('inert'), '');
    assert.equal(h.player.audio.getAttribute('src'), null);
    assert.equal(h.ytPlayers.length, 1);
    h.ytPlayers[0].config.events.onReady();
    assert.equal(h.ytCalls.find(call => call.method === 'load').video.videoId, 'VYOjWnS4cMY');
    assert.equal(h.elements.get('toast-container')?.children.length || 0, 0, 'successful hidden fallback needs no error messages');
});

test('a YouTube play rejection falls back even without an HTML error event', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    assert.equal(h.player.state.isYtPlaying, true);
    assert.equal(h.ytPlayers.length, 1);
});

test('a mid-track YouTube stall resumes hidden audio at the same position', async () => {
    const h = harness(undefined, true);
    h.player.setupAudioListeners();
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.player.audio.currentTime = 42;
    h.player.audio.emit('timeupdate');
    h.player.audio.emit('waiting');
    await h.advance(10000);
    h.ytPlayers[0].config.events.onReady();
    assert.equal(h.ytCalls.find(call => call.method === 'load').video.startSeconds, 42);
    assert.equal(h.player.state.isYtPlaying, true);
    assert.equal(h.player.state.isYtVideoVisible, false);
    assert.equal(h.elements.get('app').classList.contains('youtube-video-open'), false);
});

test('a hidden fallback remains on the same engine when Video is toggled', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.ytPlayers[0].config.events.onReady();
    const callsBeforeToggle = h.ytCalls.length;
    h.player.toggleYouTubeVideo();
    assert.equal(h.player.state.isYtVideoVisible, true);
    assert.equal(h.elements.get('yt-video-btn').getAttribute('aria-pressed'), 'true');
    assert.equal(h.elements.get('yt-player-host').getAttribute('aria-hidden'), 'false');
    h.player.toggleYouTubeVideo();
    assert.equal(h.player.state.isYtVideoVisible, false);
    assert.equal(h.ytCalls.length, callsBeforeToggle);
    assert.equal(h.player.audio.playCalls, 1);
    assert.equal(h.player.state.isPlaying, true);
});

test('BitGroove controls pause, play, seek and mute hidden YouTube audio', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.ytPlayers[0].config.events.onReady();
    h.player.togglePlay();
    assert.equal(h.ytCalls.at(-1).method, 'pause');
    assert.equal(h.player.state.isPlaying, false);
    h.player.togglePlay();
    assert.equal(h.ytCalls.at(-1).method, 'play');
    assert.equal(h.player.state.isPlaying, true);
    h.player.seekTo(50);
    assert.equal(h.ytCalls.at(-1).method, 'seek');
    assert.equal(h.ytCalls.at(-1).seconds, 15);
    h.player.setVolume(25);
    assert.equal(h.ytCalls.at(-1).volume, 25);
    h.player.toggleMute();
    assert.equal(h.ytCalls.at(-1).volume, 0);
    h.player.toggleMute();
    assert.equal(h.ytCalls.at(-1).volume, 25);
    assert.equal(h.player.audio.playCalls, 1, 'controls must not restart the failed audio element');
    assert.equal(h.player.state.isYtVideoVisible, false);
});

test('seeking hidden audio before the YouTube engine is ready updates its start position', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk', duration: 100 }));
    h.player.seekTo(75);
    h.ytPlayers[0].config.events.onReady();
    assert.equal(h.ytCalls.find(call => call.method === 'load').video.startSeconds, 75);
    assert.equal(h.player.state.isYtVideoVisible, false);
});

test('the sleep timer pauses hidden YouTube audio through the active engine', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.ytPlayers[0].config.events.onReady();
    h.player.setSleepTimer(1);
    h.player.state.sleepTimer.remainingSeconds = 1;
    await h.advance(1000);
    assert.equal(h.ytCalls.at(-1).method, 'pause');
    assert.equal(h.player.state.isPlaying, false);
});

test('hidden YouTube audio ends into the queue with video still disabled', async () => {
    const h = harness(undefined, true);
    h.player.state.settings.autoplay = false;
    const youtube = song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' });
    h.player.state.queue = [youtube, song('next')];
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(youtube);
    h.ytPlayers[0].config.events.onReady();
    h.player.onYTStateChange({ data: 0 });
    await settle();
    assert.equal(h.player.state.currentSong.id, 'next');
    assert.equal(h.player.state.queueIndex, 1);
    assert.equal(h.player.state.isYtVideoVisible, false);
    assert.equal(h.elements.get('app').classList.contains('youtube-video-open'), false);
    assert.equal(h.player.state.isPlaying, true);
});

test('a pending YouTube audio load times out and uses the player', async () => {
    const h = harness(undefined, true);
    const pending = deferred();
    h.player.audio.nextPlay = pending.promise;
    const playing = h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    await h.advance(10000);
    assert.equal(h.player.state.isYtPlaying, true);
    pending.reject(Object.assign(new Error('Cancelled for fallback'), { name: 'AbortError' }));
    await playing;
    assert.equal(h.ytPlayers.length, 1);
});

test('pausing a stalled YouTube track cancels automatic fallback', async () => {
    const h = harness(undefined, true);
    h.player.setupAudioListeners();
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.player.audio.emit('waiting');
    h.player.togglePlay();
    await h.advance(15000);
    assert.equal(h.player.state.isPlaying, false);
    assert.equal(h.ytPlayers.length, 0);
});

test('recovered buffering clears the YouTube fallback timer', async () => {
    const h = harness(undefined, true);
    h.player.setupAudioListeners();
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.player.audio.emit('waiting');
    await h.advance(5000);
    h.player.audio.emit('playing');
    await h.advance(10000);
    assert.equal(h.ytPlayers.length, 0);
    assert.equal(h.player.state.isPlaying, true);
});

test('late YouTube failures and watchdogs cannot interrupt a newer track', async () => {
    const h = harness(undefined, true);
    h.player.setupAudioListeners();
    const failed = deferred();
    h.player.audio.nextPlay = failed.promise;
    const old = h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    await h.player.playSong(song('latest'));
    failed.reject(Object.assign(new Error('Old stream failed'), { name: 'NotSupportedError' }));
    await old;
    h.player.audio.emit('error'); // Queued event after the media error was cleared by a source change.
    await h.advance(15000);
    assert.equal(h.player.state.currentSong.id, 'latest');
    assert.equal(h.player.state.isPlaying, true);
    assert.equal(h.ytPlayers.length, 0);
});

test('browser autoplay restrictions prompt for play without starting a fallback', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    await h.advance(15000);
    assert.equal(h.ytPlayers.length, 0);
    assert.equal(h.player.state.isPlaying, false);
});

test('fallback waits for the iframe API and respects pause before the player is ready', async () => {
    const h = harness(undefined, true);
    const constructor = h.context.YT.Player;
    delete h.context.YT.Player;
    h.context.onYouTubeIframeAPIReady();
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    assert.equal(h.ytPlayers.length, 0);
    h.player.togglePlay();
    h.context.YT.Player = constructor;
    h.context.onYouTubeIframeAPIReady();
    h.ytPlayers[0].config.events.onReady();
    assert.equal(h.ytCalls.find(call => call.method === 'cue').video.videoId, 'abcdefghijk');
    assert.equal(h.ytCalls.some(call => call.method === 'play'), false);
    assert.equal(h.player.state.isPlaying, false);
});

test('an existing ready YouTube player loads subsequent tracks immediately', async () => {
    const h = harness(undefined, true);
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.player.toggleYouTubeVideo();
    h.ytPlayers[0].config.events.onReady();
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-VYOjWnS4cMY', { source: 'youtube', ytId: 'VYOjWnS4cMY' }));
    assert.equal(h.ytPlayers.length, 1);
    assert.equal(h.ytCalls.filter(call => call.method === 'load').at(-1).video.videoId, 'VYOjWnS4cMY');
});

test('unplayable embeds stop cleanly without looping back into failed audio', async () => {
    const h = harness(undefined, true);
    h.player.audio.nextPlay = Promise.reject(Object.assign(new Error('Failed'), { name: 'NotSupportedError' }));
    await h.player.playSong(song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk' }));
    h.ytPlayers[0].config.events.onReady();
    h.player.onYTError({ data: 150 });
    await h.advance(15000);
    assert.equal(h.player.state.isPlaying, false);
    assert.equal(h.player.audio.playCalls, 1);
    assert.equal(h.player.state.currentSong.id, 'yt-abcdefghijk');
    h.player.togglePlay();
    assert.equal(h.ytCalls.filter(call => call.method === 'load').length, 2, 'retry reloads the same video');
});

test('manual Next advances under repeat-one while ended repeats the current song', async () => {
    const h = harness();
    h.player.setupAudioListeners();
    h.player.setQueue([song('first'), song('second')]);
    await settle();
    h.player.state.repeatMode = 'one';
    h.player.playNext();
    await settle();
    assert.equal(h.player.state.currentSong.id, 'second');
    const callsBeforeEnd = h.player.audio.playCalls;
    h.player.audio.emit('ended');
    await settle();
    assert.equal(h.player.state.currentSong.id, 'second');
    assert.ok(h.player.audio.playCalls > callsBeforeEnd, 'ended should restart repeat-one');
});

test('a superseded play rejection cannot pause the latest selected track', async () => {
    const h = harness();
    h.player.setupAudioListeners();
    const firstPlay = deferred();
    h.player.audio.nextPlay = firstPlay.promise;
    const oldRequest = h.player.playSong(song('old'));
    await h.player.playSong(song('latest'));
    firstPlay.reject(Object.assign(new Error('superseded'), { name: 'AbortError' }));
    await oldRequest;
    await settle();
    assert.equal(h.player.state.currentSong.id, 'latest');
    assert.equal(h.player.state.isPlaying, true);
});

test('an HTML media error while YouTube is selected cannot skip the video', async () => {
    const h = harness();
    h.player.setupAudioListeners();
    const youtube = song('yt-abcdefghijk', { source: 'youtube', ytId: 'abcdefghijk', downloadUrl: [] });
    h.player.state.queue = [youtube, song('other')];
    h.player.state.queueIndex = 0;
    h.player.state.currentSong = youtube;
    h.player.state.isYtPlaying = true;
    h.player.audio.error = { code: 4 };
    h.player.audio.emit('error');
    await h.advance(2000);
    assert.equal(h.player.state.currentSong.id, youtube.id);
    assert.equal(h.player.state.queueIndex, 0);
});

test('stale YouTube events cannot change HTML playback or its queue', async () => {
    const h = harness();
    h.player.setupAudioListeners();
    h.player.setQueue([song('current'), song('other')]);
    await settle();
    h.player.onYTStateChange({ data: 2 });
    assert.equal(h.player.state.isPlaying, true);
    h.player.onYTStateChange({ data: 1 });
    assert.equal(h.player.state.isYtPlaying, false);
    h.player.onYTStateChange({ data: 0 });
    h.player.onYTError({ data: 150 });
    await h.advance(2000);
    assert.equal(h.player.state.currentSong.id, 'current');
});

test('failed audio stays selected and does not silently jump to another song', async () => {
    const h = harness();
    h.player.setupAudioListeners();
    h.player.setQueue([song('failed'), song('other')]);
    await settle();
    h.player.audio.error = { code: 4 };
    h.player.audio.emit('error');
    await h.advance(2000);
    assert.equal(h.player.state.currentSong.id, 'failed');
    assert.equal(h.player.state.queueIndex, 0);
    assert.equal(h.player.state.isPlaying, false);
});

test('search shows only the newest query even if an older response arrives later', async () => {
    const oldResponse = deferred();
    const h = harness((url) => String(url).includes('query=old') ? oldResponse.promise : Promise.resolve(response([song('new-result')])));
    h.elements.set('search-input', { value: 'old' });
    h.player.performSearch('old');
    await h.advance(400);
    h.elements.get('search-input').value = 'new';
    h.player.performSearch('new');
    await h.advance(400);
    oldResponse.resolve(response([song('old-result')]));
    await settle();
    const results = h.elements.get('search-results');
    assert.ok(results.innerHTML.includes('new-result'));
    assert.ok(!results.innerHTML.includes('old-result'));
    const oldFetch = h.fetches.find(f => f.url.includes('query=old'));
    assert.ok(oldFetch.options.signal?.aborted, 'superseded search should abort its request');
});

test('clearing the query invalidates a response already in flight', async () => {
    const inFlight = deferred();
    const h = harness(() => inFlight.promise);
    h.player.performSearch('pending');
    await h.advance(400);
    h.player.performSearch('');
    await h.advance(400);
    inFlight.resolve(response([song('obsolete')]));
    await settle();
    const results = h.elements.get('search-results');
    assert.ok(!results.innerHTML.includes('obsolete'));
    assert.equal(h.player.state.lastSearchResults?.length || 0, 0);
});

test('changing search filters invalidates older song results', async () => {
    const oldSongs = deferred();
    const h = harness((url) => String(url).includes('/search/songs') ? oldSongs.promise : Promise.resolve(response([])));
    h.player.performSearch('same');
    await h.advance(400);
    h.player.state.searchFilter = 'albums';
    h.player.performSearch('same');
    await h.advance(400);
    oldSongs.resolve(response([song('obsolete-song')]));
    await settle();
    assert.ok(!h.elements.get('search-results').innerHTML.includes('obsolete-song'));
});

test('Play Next in shuffle preserves valid indices and selects the inserted song next', async () => {
    const h = harness();
    h.player.state.isShuffle = true;
    h.player.setQueue([song('a'), song('b'), song('c')]);
    await settle();
    h.player.addNextToQueue(song('inserted'));
    h.player.playNext();
    await settle();
    assert.equal(h.player.state.currentSong.id, 'inserted');
    const indices = Array.from(h.player.state.shuffledIndices);
    assert.equal(new Set(indices).size, h.player.state.queue.length);
    assert.ok(indices.every(index => index >= 0 && index < h.player.state.queue.length));
});

test('clear queue resets shuffled navigation to the current song', async () => {
    const h = harness();
    h.player.state.isShuffle = true;
    h.player.setQueue([song('a'), song('b'), song('c')]);
    await settle();
    h.player.clearQueue();
    assert.equal(h.player.state.queue.length, 1);
    assert.deepEqual(Array.from(h.player.state.shuffledIndices), [0]);
    assert.equal(h.player.state.shufflePointer, 0);
    h.player.playNext();
    await settle();
    assert.equal(h.player.state.currentSong.id, 'a');
});

test('autoplay starts enabled and queues unique playable recommendations after manual tracks', async () => {
    const seed = song('seed');
    const manual = song('manual');
    const recent = song('recent');
    const duplicateTitle = song('provider-copy', { name: seed.name });
    const h = harness(async () => response([
        seed, manual, recent, duplicateTitle, song('related'), song('related'), song('unplayable', { downloadUrl: [] })
    ]));
    h.player.state.recentlyPlayed = [recent];
    h.player.setQueue([seed, manual]);
    await settle();
    assert.equal(h.player.state.settings.autoplay, true);
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed', 'manual', 'related']);
    assert.equal(h.player.state.queue[2].autoRecommended, true);
    assert.equal(h.elements.get('related-section').hidden, false);
    assert.ok(h.elements.get('related-songs').innerHTML.includes('related'));
    const request = h.fetches.find(item => item.url.includes('/suggestions'));
    assert.ok(request.url.includes('name=seed'));
    assert.ok(request.url.includes('artist=Test+Artist'));
});

test('natural endings continue through multiple recommendation batches without repeating tracks', async () => {
    const waves = { seed: ['a', 'b'], a: ['c', 'd'], b: ['e', 'f'], c: ['g', 'h'] };
    const h = harness(async url => {
        const id = String(url).match(/\/songs\/([^/]+)\/suggestions/)?.[1];
        return response((waves[id] || []).map(value => song(value)));
    });
    h.player.setupAudioListeners();
    h.player.setQueue([song('seed')]);
    await settle();
    for (const expected of ['a', 'b', 'c']) {
        h.player.audio.emit('ended');
        await settle();
        assert.equal(h.player.state.currentSong.id, expected);
        assert.equal(h.player.state.isPlaying, true);
    }
    const ids = Array.from(h.player.state.queue, item => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('f'), 'new recommendation batches should be prepared ahead of the ending');
});

test('recommendation requests exclude queued and played songs before the server applies its limit', async () => {
    const manual = song('manual');
    const played = song('played');
    const h = harness(async url => {
        const excluded = JSON.parse(new URL(String(url), 'http://localhost:3000').searchParams.get('exclude') || '[]');
        // A provider can return fresh music only when consumed IDs are filtered before its result limit.
        return response(excluded.includes(manual.id) && excluded.includes(played.id) ? [song('fresh')] : [manual, played]);
    });
    h.player.state.recentlyPlayed = [played, played];
    h.player.setQueue([song('seed'), manual]);
    await settle();
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed', 'manual', 'fresh']);
    const request = h.fetches.find(item => item.url.includes('/suggestions'));
    const excluded = JSON.parse(new URL(request.url, 'http://localhost:3000').searchParams.get('exclude'));
    assert.deepEqual(excluded, ['seed', 'manual', 'played']);
});

test('recommendation exclusions are bounded and prioritize the current and upcoming songs', async () => {
    const h = harness();
    h.player.state.queue = Array.from({ length: 130 }, (_, index) => song(`queued-${index}`));
    h.player.state.queueIndex = 10;
    h.player.state.currentSong = h.player.state.queue[10];
    h.player.state.recentlyPlayed = Array.from({ length: 50 }, (_, index) => song(`played-${index}`));
    await h.player.API.getSongSuggestions('queued-10', h.player.state.currentSong);
    const request = h.fetches.find(item => item.url.includes('/suggestions'));
    const excluded = JSON.parse(new URL(request.url, 'http://localhost:3000').searchParams.get('exclude'));
    assert.equal(excluded.length, 100);
    assert.equal(new Set(excluded).size, 100);
    assert.equal(excluded[0], 'queued-10');
    assert.equal(excluded[1], 'queued-11');
    assert.ok(!excluded.includes('queued-0'), 'old queue history should not displace upcoming music');
});

test('an ending waits for its in-flight recommendations and advances once they arrive', async () => {
    const pending = deferred();
    const h = harness(url => String(url).includes('/seed/suggestions') ? pending.promise : Promise.resolve(response([])));
    h.player.setupAudioListeners();
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.audio.emit('ended');
    await settle();
    assert.equal(h.player.state.currentSong.id, 'seed');
    pending.resolve(response([song('next')]));
    await settle();
    assert.equal(h.player.state.currentSong.id, 'next');
    assert.equal(h.player.state.isPlaying, true);
});

test('a superseded recommendation request cannot change the new queue or related section', async () => {
    const old = deferred();
    const h = harness(url => String(url).includes('/old/suggestions') ? old.promise : Promise.resolve(response([song('new-related')])));
    h.player.setQueue([song('old')]);
    await settle();
    h.player.setQueue([song('new')]);
    await settle();
    old.resolve(response([song('old-related')]));
    await settle();
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['new', 'new-related']);
    assert.ok(!h.elements.get('related-songs').innerHTML.includes('old-related'));
    assert.equal(h.fetches.find(item => item.url.includes('/old/suggestions')).options.signal.aborted, true);
});

test('clear queue cancels pending autoplay and preserves the current track', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    h.player.setupAudioListeners();
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.audio.emit('ended');
    h.player.clearQueue();
    pending.resolve(response([song('late')]));
    await settle();
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed']);
    assert.equal(h.player.state.currentSong.id, 'seed');
    assert.equal(h.player.state.isPlaying, false);
});

test('pausing while autoplay waits prevents a late response from starting another song', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    h.player.setupAudioListeners();
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.audio.emit('ended');
    // A user resumes the selected track and then pauses it while discovery is pending.
    h.player.togglePlay();
    await settle();
    h.player.togglePlay();
    pending.resolve(response([song('late')]));
    await settle();
    assert.equal(h.player.state.currentSong.id, 'seed');
    assert.equal(h.player.state.isPlaying, false);
});

test('turning autoplay off removes only automatic future tracks and still shows recommendations', async () => {
    const h = harness(async () => response([song('related-a'), song('related-b')]));
    h.player.setQueue([song('seed'), song('manual')]);
    await settle();
    h.player.setAutoplay(false);
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed', 'manual']);
    assert.equal(h.player.state.relatedSongs.length, 2);
    h.player.setAutoplay(true);
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed', 'manual', 'related-a', 'related-b']);
});

test('manual queue additions retain priority over automatic music including shuffle', async () => {
    const h = harness(async () => response([song('auto-a'), song('auto-b')]));
    h.player.state.isShuffle = true;
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.addToQueue(song('manual'));
    h.player.playNext();
    await settle();
    assert.equal(h.player.state.currentSong.id, 'manual');
    const indices = Array.from(h.player.state.shuffledIndices);
    assert.equal(new Set(indices).size, h.player.state.queue.length);
    assert.ok(indices.every(index => index >= 0 && index < h.player.state.queue.length));
});

test('removed automatic tracks are not re-added by later discovery results', async () => {
    const h = harness(async () => response([song('removed'), song('kept')]));
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.removeFromQueue(1);
    await h.player.loadRelatedSongs(h.player.state.currentSong);
    assert.ok(!h.player.state.queue.some(item => item.id === 'removed'));
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed', 'kept']);
});

test('repeat-all retains the authored queue instead of appending autoplay music', async () => {
    const h = harness(async () => response([song('related')]));
    h.player.state.repeatMode = 'all';
    h.player.setQueue([song('seed'), song('manual')], 1);
    await settle();
    assert.equal(h.player.state.queue.length, 2);
    await h.player.playNext(false);
    await settle();
    assert.equal(h.player.state.currentSong.id, 'seed');
});

test('a failed recommendation service does not queue fabricated tracks', async () => {
    const h = harness(async () => { throw new Error('offline'); });
    h.player.setupAudioListeners();
    h.player.setQueue([song('seed')]);
    await settle();
    h.player.audio.emit('ended');
    await settle();
    assert.deepEqual(Array.from(h.player.state.queue, item => item.id), ['seed']);
    assert.equal(h.player.state.isPlaying, false);
    assert.equal(h.player.state.recommendationsUnavailable, true);
    assert.ok(h.elements.get('autoplay-status').textContent.includes('unavailable'));
    assert.ok(h.fetches.length <= 2, 'failure retry must remain bounded');
});

function discoveryFixture() {
    return {
        trending: { songs: [song('trending-real')] },
        albums: [{ id: 'deezer-album-42', name: 'A New Release', image: [], songs: [song('album-track')] }],
        charts: [{ id: 'deezer-chart-global', name: 'Deezer Top Tracks', image: [], songs: [song('chart-track')] }],
        playlists: [{ id: 'mix-acoustic', name: 'Acoustic Moments', image: [], songs: [song('playlist-track')] }]
    };
}

function moduleResponse(data) {
    return { ok: true, status: 200, async json() { return { success: true, data }; } };
}

test('home discovery uses the API route and populates every shelf with clickable data', async () => {
    const h = harness(async () => moduleResponse(discoveryFixture()));
    await h.player.loadHomePage();
    assert.ok(h.fetches[0].url.startsWith('/api/modules?'));
    assert.ok(h.elements.get('trending-songs').innerHTML.includes('trending-real'));
    assert.ok(h.elements.get('new-releases').innerHTML.includes('A New Release'));
    assert.ok(h.elements.get('top-charts').innerHTML.includes('Deezer Top Tracks'));
    assert.ok(h.elements.get('top-playlists').innerHTML.includes('Acoustic Moments'));
    assert.equal(h.elements.get('new-releases')._albums[0].id, 'deezer-album-42');
    assert.equal(h.elements.get('top-playlists')._playlists[0].songs[0].id, 'playlist-track');
    assert.equal(h.player.state.queue.length, 0, 'discovering tracks must not start playback');
});

test('an older home discovery response cannot replace a newer reload', async () => {
    const old = deferred();
    let requests = 0;
    const h = harness(() => ++requests === 1 ? old.promise : Promise.resolve(moduleResponse(discoveryFixture())));
    const firstLoad = h.player.loadHomePage();
    await h.player.loadHomePage();
    old.resolve(moduleResponse({ ...discoveryFixture(), trending: { songs: [song('obsolete')] } }));
    await firstLoad;
    assert.ok(h.elements.get('trending-songs').innerHTML.includes('trending-real'));
    assert.ok(!h.elements.get('trending-songs').innerHTML.includes('obsolete'));
});

test('unavailable discovery shows retry states without fabricated releases or charts', async () => {
    const h = harness(async () => { throw new Error('offline'); });
    await h.player.loadHomePage();
    for (const id of ['trending-songs', 'new-releases', 'top-charts', 'top-playlists']) {
        const html = h.elements.get(id).innerHTML;
        assert.ok(html.includes('temporarily unavailable'), id);
        assert.ok(html.includes('data-retry-discovery'), id);
        assert.ok(!html.includes('curated-'), id);
    }
    await h.player.renderChartsPage();
    assert.ok(!h.elements.get('charts-grid').innerHTML.includes('chart-1'));
});

test('online playlist and artist lookup use their API routes', async () => {
    const h = harness(async () => moduleResponse({ id: 'found', name: 'Found' }));
    await h.player.API.getPlaylist('deezer-playlist-42');
    await h.player.API.getArtist('artist/42');
    assert.ok(h.fetches[0].url.startsWith('/api/playlists?id=deezer-playlist-42'));
    assert.equal(h.fetches[1].url, '/api/artists/artist%2F42');
});

test('inline album and playlist details retain playable tracks without a second lookup', async () => {
    const h = harness(async () => { throw new Error('unexpected lookup'); });
    const fixture = discoveryFixture();
    await h.player.renderAlbumDetailPage(fixture.albums[0]);
    await h.player.renderPlaylistDetailPage(fixture.playlists[0]);
    assert.equal(h.fetches.length, 0);
    assert.equal(h.elements.get('album-songs-list')._songs[0].id, 'album-track');
    assert.equal(h.elements.get('playlist-songs-list')._songs[0].id, 'playlist-track');
});

test('a chart card opens its cached songs through document click delegation', async () => {
    const h = harness(async () => moduleResponse(discoveryFixture()));
    await h.player.loadHomePage();
    h.player.setupEventListeners();
    const container = h.elements.get('top-charts');
    const card = { dataset: { playlistId: 'deezer-chart-global' }, closest() { return container; } };
    h.emitDocument('click', { target: { closest(selector) { return selector === '.playlist-card' ? card : null; } } });
    await settle();
    assert.equal(h.player.state.currentPage, 'playlist-detail');
    assert.equal(h.elements.get('playlist-songs-list')._songs[0].id, 'chart-track');
    assert.equal(h.fetches.length, 1, 'cached chart should open without a broken synthetic ID lookup');
});

test('retry refreshes the visible charts page as well as the home shelves', async () => {
    const h = harness(async () => moduleResponse(discoveryFixture()));
    h.player.state.currentPage = 'charts';
    await h.player.retryDiscovery();
    assert.ok(h.elements.get('charts-grid').innerHTML.includes('Deezer Top Tracks'));
});

test('late album and playlist details cannot overwrite the latest selection', async () => {
    for (const [render, prefix] of [['renderAlbumDetailPage', 'album'], ['renderPlaylistDetailPage', 'playlist']]) {
        const old = deferred();
        const h = harness(url => String(url).includes('id=old') ? old.promise : Promise.resolve(moduleResponse({ id: 'new', name: 'New selection', songs: [song('new-track')] })));
        const pending = h.player[render]('old');
        await h.player[render]('new');
        old.resolve(moduleResponse({ id: 'old', name: 'Old selection', songs: [song('old-track')] }));
        await pending;
        assert.equal(h.elements.get(`${prefix}-songs-list`)._songs[0].id, 'new-track');
        assert.ok(h.elements.get(`${prefix}-detail-header`).innerHTML.includes('New selection'));
    }
});

test('shuffle repeat-all starts a new cycle with a different track', async () => {
    const h = harness();
    h.player.state.isShuffle = true;
    h.player.state.repeatMode = 'all';
    h.player.setQueue([song('a'), song('b'), song('c')]);
    await settle();
    h.player.state.shuffledIndices = [1, 2, 0];
    h.player.state.shufflePointer = 2;
    await h.player.playNext(false);
    await settle();
    assert.notEqual(h.player.state.currentSong.id, 'a');
    assert.equal(new Set(h.player.state.shuffledIndices).size, 3);
});

test('an API request retains its timeout when a caller supplies a cancellation signal', async () => {
    const h = harness((url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    }));
    const caller = new AbortController();
    const timedOut = assert.rejects(h.player.API.request('/api/modules', caller.signal), { name: 'AbortError' });
    await h.advance(15000);
    await timedOut;
    assert.equal(h.fetches[0].options.signal.aborted, true);
    const cancelled = assert.rejects(h.player.API.request('/api/modules', caller.signal), { name: 'AbortError' });
    caller.abort();
    await cancelled;
    assert.equal(h.fetches[1].options.signal.aborted, true);
});
