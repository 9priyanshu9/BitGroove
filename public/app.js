/**
 * BitGroove - Open Source Music Player & Streaming App
 * Inspired by BitChord & Apple Music
 * Features: JioSaavn & Open Source Music Streaming, 10-Band EQ, Synced Lyrics,
 * Queue, Local Playlists, Favorites, Downloads, Offline Caching, MediaSession.
 */

(function () {
    'use strict';

    // ==========================================
    // 1. STATE MANAGEMENT
    // ==========================================
    const state = {
        currentSong: null,
        queue: [],
        queueIndex: -1,
        shuffledIndices: [],
        shufflePointer: -1,
        isPlaying: false,
        isYtPlaying: false,
        isYtVideoVisible: false,
        pendingYtId: null,
        isShuffle: false,
        repeatMode: 'none', // 'none' | 'all' | 'one'
        volume: 80,
        isMuted: false,
        previousVolume: 80,
        currentTime: 0,
        duration: 0,
        favorites: [],
        playlists: [],
        recentlyPlayed: [],
        downloads: [],
        searchFilter: 'songs',
        currentPage: 'home',
        pageHistory: ['home'],
        historyIndex: 0,
        selectedSongForContext: null,
        relatedSongs: [],
        recommendationsLoading: false,
        recommendationsUnavailable: false,
        settings: {
            streamingQuality: '160kbps', // 12kbps, 48kbps, 96kbps, 160kbps, 320kbps
            downloadQuality: '320kbps',
            crossfade: 0,
            gapless: true,
            automix: false,
            autoplay: true,
            theme: 'dark',
            accentColor: '#e91e63',
            dynamicBg: true,
            languages: ['hindi', 'english']
        },
        sleepTimer: {
            durationMinutes: 0,
            remainingSeconds: 0,
            intervalId: null
        },
        audioInitialized: false,
        eqPreset: 'flat',
        eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        bassBoostValue: 0,
        virtualizerValue: 0
    };

    // ==========================================
    // 2. EQUALIZER CONFIG & PRESETS
    // ==========================================
    const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const EQ_PRESETS = {
        'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        'bass-boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
        'treble-boost': [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
        'vocal': [-2, -1, 0, 2, 4, 4, 3, 1, 0, -2],
        'rock': [4, 3, 1, 0, -1, -1, 0, 2, 3, 4],
        'pop': [-1, 1, 3, 4, 3, 0, -1, -1, -1, -1],
        'jazz': [3, 2, 0, 2, -2, -2, 0, 1, 2, 3],
        'classical': [4, 3, 2, 1, -1, -1, 0, 1, 2, 4],
        'electronic': [4, 3, 0, -2, -1, 0, 2, 4, 4, 3],
        'hip-hop': [4, 4, 3, 0, -1, -1, 1, 0, 2, 3]
    };

    // Web Audio API objects
    let audioContext = null;
    let audioSourceNode = null;
    let eqFilterNodes = [];
    let bassBoostNode = null;
    let masterGainNode = null;

    // The primary HTML5 audio element
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';

    // Curated high-quality open-source fallback tracks for instant playback & testing
    const CURATED_FALLBACK_SONGS = [
        {
            id: 'curated-1',
            name: 'Starry Serenade',
            primaryArtists: 'Acoustic Reverie',
            album: { name: 'Midnight Reflections' },
            year: '2024',
            duration: 215,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3' }]
        },
        {
            id: 'curated-2',
            name: 'Neon Cyberpunk Groove',
            primaryArtists: 'Synthwave City',
            album: { name: 'Future Memories' },
            year: '2024',
            duration: 184,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=electronic-future-beats-117997.mp3' }]
        },
        {
            id: 'curated-3',
            name: 'Chasing the Sunset',
            primaryArtists: 'Tropical Breeze',
            album: { name: 'Golden Horizons' },
            year: '2024',
            duration: 198,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=tropical-summer-10874.mp3' }]
        },
        {
            id: 'curated-4',
            name: 'Urban Coffee Chill',
            primaryArtists: 'Lo-Fi Chillhop Project',
            album: { name: 'Rainy Cafe Vibes' },
            year: '2024',
            duration: 160,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_249e9e1cf4.mp3?filename=chill-abstract-intention-12099.mp3' }]
        },
        {
            id: 'curated-5',
            name: 'Deep Space Journey',
            primaryArtists: 'Cosmic Ambient',
            album: { name: 'Voyager Echoes' },
            year: '2024',
            duration: 242,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2021/09/06/audio_9b96c8ca38.mp3?filename=ambient-piano-amp-strings-10711.mp3' }]
        },
        {
            id: 'curated-6',
            name: 'Bollywood Acoustic Soul',
            primaryArtists: 'Desi Unplugged',
            album: { name: 'Sufi Strings' },
            year: '2024',
            duration: 210,
            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80' }],
            downloadUrl: [{ quality: '320kbps', link: 'https://cdn.pixabay.com/download/audio/2022/10/14/audio_9939f792cb.mp3?filename=acoustic-guitars-ambient-uplifting-122787.mp3' }]
        }
    ];

    // ==========================================
    // 3. API SERVICE WITH RESILIENT FALLBACKS
    // ==========================================
    const API = {
        // Generic bounded fetch to any path on the same origin
        async request(path, signal) {
            const controller = new AbortController();
            const abortRequest = () => controller.abort();
            if (signal?.aborted) abortRequest();
            else signal?.addEventListener('abort', abortRequest, { once: true });
            const timeoutId = setTimeout(abortRequest, 15000);
            try {
                const res = await fetch(path, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (json && json.success === false) throw new Error(json.error || 'API error');
                return json;
            } finally {
                clearTimeout(timeoutId);
                signal?.removeEventListener('abort', abortRequest);
            }
        },

        async searchSongs(query, page = 0, limit = 30, signal) {
            query = query.trim();
            if (!query) return [];

            // 1. Try local proxy server (queries JioSaavn with DES decryption)
            try {
                const json = await this.request(`/api/search/songs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`, signal);
                if (signal?.aborted) throw Object.assign(new Error('Search cancelled'), { name: 'AbortError' });
                const results = json.data?.results || json.results || [];
                if (Array.isArray(results) && results.length > 0) {
                    return results;
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('Local proxy search error, trying direct iTunes & Audius...', err.message);
            }

            // 2. Direct browser fetch to iTunes Search API (100% open, zero auth, works worldwide for ANY song)
            try {
                const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
                const itunesRes = await fetch(itunesUrl, { signal });
                if (itunesRes.ok) {
                    const itunesJson = await itunesRes.json();
                    if (itunesJson && Array.isArray(itunesJson.results) && itunesJson.results.length > 0) {
                        const formatted = itunesJson.results
                            .filter(item => item.previewUrl)
                            .map(item => ({
                                id: `itunes-${item.trackId}`,
                                name: item.trackName || 'Unknown Title',
                                album: { id: item.collectionId, name: item.collectionName || 'Single' },
                                year: (item.releaseDate || '').substring(0, 4),
                                duration: 30,
                                originalDuration: Math.round((item.trackTimeMillis || 0) / 1000),
                                isPreview: true,
                                source: 'itunes',
                                primaryArtists: item.artistName || 'Unknown Artist',
                                image: [
                                    { quality: '500x500', link: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb') }
                                ],
                                downloadUrl: [
                                    { quality: '320kbps', link: item.previewUrl }
                                ],
                                hasLyrics: false
                            }));

                        if (formatted.length > 0) {
                            return formatted;
                        }
                    }
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('iTunes direct search failed:', err.message);
            }

            // 3. Direct browser fetch to Audius API (Decentralized Open Source Music)
            try {
                const audiusUrl = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=BitGroove`;
                const audiusRes = await fetch(audiusUrl, { signal });
                if (audiusRes.ok) {
                    const audiusJson = await audiusRes.json();
                    if (audiusJson?.data && Array.isArray(audiusJson.data) && audiusJson.data.length > 0) {
                        const formatted = audiusJson.data.map(track => ({
                            id: `audius-${track.id}`,
                            name: track.title,
                            album: { name: 'Audius Release' },
                            year: (track.release_date || '').substring(0, 4) || '2024',
                            duration: track.duration || 180,
                            primaryArtists: track.user?.name || 'Audius Creator',
                            image: [
                                { quality: '500x500', link: track.artwork?.['480x480'] || track.artwork?.['150x150'] || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600' }
                            ],
                            downloadUrl: [
                                { quality: '320kbps', link: `https://discoveryprovider.audius.co/v1/tracks/${track.id}/stream?app_name=BitGroove` }
                            ],
                            hasLyrics: false
                        }));
                        if (formatted.length > 0) return formatted;
                    }
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('Audius search failed:', err.message);
            }

            // 4. Deezer API - worldwide catalog, free, 30s previews (Spotify equivalent)
            try {
                const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal });
                if (deezerRes.ok) {
                    const deezerJson = await deezerRes.json();
                    const formatted = (deezerJson.data || [])
                        .filter(t => t.preview)
                        .map(t => ({
                            id: `deezer-${t.id}`,
                            name: t.title,
                            primaryArtists: t.artist?.name || '',
                            album: { name: t.album?.title || '' },
                            year: '',
                            duration: 30,
                            originalDuration: t.duration || 30,
                            isPreview: true,
                            image: [
                                { quality: '150x150', link: t.album?.cover_medium || '' },
                                { quality: '500x500', link: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || '' }
                            ],
                            downloadUrl: [{ quality: '128kbps', link: t.preview }],
                            hasLyrics: false,
                            source: 'deezer'
                        }));
                    if (formatted.length > 0) return formatted;
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('Deezer direct search failed:', err.message);
            }

            // 5. YouTube via server-side Piped proxy (full songs, needs stream resolution)
            try {
                const ytRes = await fetch(`/api/yt/search?q=${encodeURIComponent(query)}`, { signal });
                if (ytRes.ok) {
                    const ytJson = await ytRes.json();
                    if (ytJson.data?.results?.length > 0) return ytJson.data.results;
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                console.warn('YouTube/Piped search failed:', err.message);
            }

            // 6. Last resort: curated fallback
            return CURATED_FALLBACK_SONGS.filter(s =>
                s.name.toLowerCase().includes(query.toLowerCase()) ||
                s.primaryArtists.toLowerCase().includes(query.toLowerCase())
            );
        },

        async searchYouTube(query, limit = 25) {
            query = query.trim();
            if (!query) return [];
            try {
                const res = await fetch(`/api/yt/search?q=${encodeURIComponent(query)}&limit=${limit}`);
                if (res.ok) {
                    const json = await res.json();
                    return json.data?.results || [];
                }
            } catch (err) {
                console.warn('YouTube search failed:', err);
            }
            return [];
        },

        async searchAlbums(query, page = 0, limit = 20) {
            query = query.trim();
            if (!query) return [];

            try {
                const res = await fetch(`/api/search/albums?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
                if (res.ok) {
                    const json = await res.json();
                    const results = json.data?.results || json.results || [];
                    if (results.length > 0) return results;
                }
            } catch (e) { }

            // Direct iTunes fallback for albums
            try {
                const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=${limit}`;
                const res = await fetch(itunesUrl);
                if (res.ok) {
                    const json = await res.json();
                    if (json.results?.length > 0) {
                        return json.results.map(a => ({
                            id: String(a.collectionId),
                            name: a.collectionName,
                            artist: a.artistName,
                            year: (a.releaseDate || '').substring(0, 4),
                            image: [{ quality: '500x500', link: (a.artworkUrl100 || '').replace('100x100bb', '600x600bb') }]
                        }));
                    }
                }
            } catch (e) { }

            return [];
        },

        async searchArtists(query, page = 0, limit = 20) {
            query = query.trim();
            if (!query) return [];

            try {
                const res = await fetch(`/api/search/artists?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
                if (res.ok) {
                    const json = await res.json();
                    const results = json.data?.results || json.results || [];
                    if (results.length > 0) return results;
                }
            } catch (e) { }

            try {
                const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=${limit}`;
                const res = await fetch(itunesUrl);
                if (res.ok) {
                    const json = await res.json();
                    if (json.results?.length > 0) {
                        return json.results.map(a => ({
                            id: String(a.artistId),
                            name: a.artistName,
                            image: [{ quality: '500x500', link: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500' }]
                        }));
                    }
                }
            } catch (e) { }

            return [];
        },

        async searchPlaylists(query, page = 0, limit = 20) {
            try {
                const res = await fetch(`/api/search/playlists?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
                if (res.ok) {
                    const json = await res.json();
                    return json.data?.results || json.results || [];
                }
            } catch (e) { }
            return [];
        },

        async getSong(id) {
            try {
                const res = await fetch(`/api/songs/${id}`);
                if (res.ok) {
                    const json = await res.json();
                    return json.data || null;
                }
            } catch (e) { }
            return CURATED_FALLBACK_SONGS.find(s => s.id === id) || null;
        },

        async getSongLyrics(id, songObj = null) {
            // 1. Try server lyrics
            try {
                const res = await fetch(`/api/songs/${id}/lyrics`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.data?.lyrics) return json.data.lyrics;
                }
            } catch (e) { }

            // 2. Try lyrics.ovh free public API
            if (songObj) {
                try {
                    const artist = encodeURIComponent(getArtistName(songObj).split(',')[0].trim());
                    const title = encodeURIComponent(getSongTitle(songObj).replace(/\(.*?\)/g, '').trim());
                    const ovhRes = await fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`);
                    if (ovhRes.ok) {
                        const json = await ovhRes.json();
                        if (json.lyrics) return json.lyrics;
                    }
                } catch (e) { }
            }

            return null;
        },

        async getSongSuggestions(id, song = null, signal = null) {
            const params = new URLSearchParams({ limit: '12' });
            const consumedIds = [id,
                ...upcomingQueueIndices().map(index => state.queue[index]?.id),
                ...state.recentlyPlayed.map(track => track.id),
                ...Array.from(excludedRecommendations).filter(key => key.startsWith('id:')).map(key => key.slice(3)),
                ...state.queue.slice().reverse().map(track => track.id)
            ].filter(value => value !== null && value !== undefined && value !== '').map(String);
            params.set('exclude', JSON.stringify(Array.from(new Set(consumedIds)).slice(0, 100)));
            if (song) {
                params.set('name', getSongTitle(song));
                params.set('artist', getArtistName(song));
                params.set('language', song.language || state.settings.languages.join(','));
            }
            try {
                const json = await this.request(`/api/songs/${encodeURIComponent(id)}/suggestions?${params}`, signal);
                const songs = json.data?.results || json.data || json.results || [];
                return Array.isArray(songs) ? songs : [];
            } catch (e) {
                if (signal?.aborted) throw e;
                return [];
            }
        },

        async getAlbum(id) {
            try {
                const res = await fetch(`/api/albums?id=${encodeURIComponent(id)}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.data) return json.data;
                }
            } catch (e) { }

            // Direct iTunes lookup fallback
            try {
                const itunesId = String(id).replace(/^itunes-album-/, '');
                if (!/^\d+$/.test(itunesId)) return null;
                const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${itunesId}&entity=song`);
                if (itunesRes.ok) {
                    const json = await itunesRes.json();
                    const items = json.results || [];
                    if (items.length > 0) {
                        const albumInfo = items[0];
                        const songs = items.slice(1).filter(s => s.previewUrl).map(s => ({
                            id: `itunes-${s.trackId}`,
                            name: s.trackName,
                            album: { name: albumInfo.collectionName },
                            duration: 30,
                            originalDuration: Math.round((s.trackTimeMillis || 0) / 1000),
                            isPreview: true,
                            source: 'itunes',
                            primaryArtists: s.artistName,
                            image: [{ quality: '500x500', link: (s.artworkUrl100 || '').replace('100x100bb', '600x600bb') }],
                            downloadUrl: [{ quality: '320kbps', link: s.previewUrl }]
                        }));
                        return {
                            id,
                            name: albumInfo.collectionName,
                            artist: albumInfo.artistName,
                            year: (albumInfo.releaseDate || '').substring(0, 4),
                            image: [{ quality: '500x500', link: (albumInfo.artworkUrl100 || '').replace('100x100bb', '600x600bb') }],
                            songs
                        };
                    }
                }
            } catch (e) { }

            return null;
        },

        async getArtist(id) {
            try {
                const res = await this.request(`/api/artists/${encodeURIComponent(id)}`);
                return res.data || null;
            } catch (e) {
                return null;
            }
        },

        async getPlaylist(id) {
            try {
                const res = await this.request(`/api/playlists?id=${encodeURIComponent(id)}`);
                return res.data || null;
            } catch (e) {
                return null;
            }
        },

        async getModules(languages = 'hindi,english') {
            try {
                const res = await this.request(`/api/modules?language=${encodeURIComponent(languages)}`);
                return res.data || res;
            } catch (e) {
                console.warn('Discovery temporarily unavailable:', e.message);
                return null;
            }
        }
    };

    // ==========================================
    // 4. HELPER UTILITIES
    // ==========================================
    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return '';
        const txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        const s = Math.floor(seconds);
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    function getImageUrl(imageArray, fallback = '') {
        if (!imageArray) return fallback;
        if (typeof imageArray === 'string') return imageArray;
        if (Array.isArray(imageArray) && imageArray.length > 0) {
            // Pick highest quality (500x500) or last item
            const best = imageArray.find(img => (img.quality === '500x500' || img.quality === 'high')) || imageArray[imageArray.length - 1];
            return best.link || best.url || fallback;
        }
        return fallback;
    }

    function getAudioStreamUrl(song, preferredQuality = '160kbps') {
        if (!song) return '';
        const urls = song.downloadUrl || song.download_url || song.media_url;
        let streamUrl = '';
        if (typeof urls === 'string') streamUrl = urls;
        else if (Array.isArray(urls) && urls.length > 0) {
            const match = urls.find(u => u.quality === preferredQuality) || urls.find(u => u.quality === '320kbps') || urls.find(u => u.quality === '160kbps') || urls[urls.length - 1];
            streamUrl = match ? (match.link || match.url) : '';
        } else streamUrl = song.url || '';
        if (!streamUrl || !/^https?:\/\//i.test(streamUrl) || streamUrl.includes('/api/stream?')) return streamUrl;
        try {
            const host = new URL(streamUrl).hostname.toLowerCase();
            const hosts = ['audio-ssl.itunes.apple.com', 'jiotunepreview.jio.com'];
            const suffixes = ['saavncdn.com', 'mzstatic.com', 'dzcdn.net', 'audius.co'];
            if (hosts.includes(host) || suffixes.some(s => host === s || host.endsWith('.' + s))) {
                return `/api/stream?url=${encodeURIComponent(streamUrl)}`;
            }
        } catch (_) {}
        return streamUrl;
    }

    function getArtistName(song) {
        if (!song) return 'Unknown Artist';
        if (song.primaryArtists) return decodeHtmlEntities(song.primaryArtists);
        if (song.primary_artists) return decodeHtmlEntities(song.primary_artists);
        if (song.singers) return decodeHtmlEntities(song.singers);
        if (song.artist) return decodeHtmlEntities(song.artist);
        if (Array.isArray(song.artists?.primary)) {
            return song.artists.primary.map(a => a.name).join(', ');
        }
        return 'Various Artists';
    }

    function getSongTitle(song) {
        if (!song) return 'Untitled Track';
        return decodeHtmlEntities(song.name || song.title || 'Untitled');
    }

    function getAlbumTitle(song) {
        if (!song) return '';
        if (typeof song.album === 'object' && song.album !== null) {
            return decodeHtmlEntities(song.album.name || '');
        }
        return decodeHtmlEntities(song.album || '');
    }

    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';

        toast.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    function showLoading(show = true) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = show ? 'flex' : 'none';
    }

    function getGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 17) return 'Good Afternoon';
        return 'Good Evening';
    }

    function generateId() {
        return 'pl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // ==========================================
    // 5. LOCAL STORAGE MANAGEMENT
    // ==========================================
    function saveStorage(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) {
            console.error('Storage save error:', e);
        }
    }

    function loadStorage(key, defaultVal) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    }

    function loadInitialStorage() {
        state.favorites = loadStorage('bitgroove_favorites', []);
        state.playlists = loadStorage('bitgroove_playlists', [
            { id: 'favorites-pl', name: 'My Top Hits', description: 'Curated personal favorites', songs: [] }
        ]);
        state.recentlyPlayed = loadStorage('bitgroove_recent', []);
        state.downloads = loadStorage('bitgroove_downloads', []);

        const savedSettings = loadStorage('bitgroove_settings', null);
        if (savedSettings) {
            state.settings = { ...state.settings, ...savedSettings };
        }
    }

    // ==========================================
    // 6. WEB AUDIO API & EQUALIZER INITIALIZATION
    // ==========================================
    function initWebAudio() {
        if (state.audioInitialized) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            audioContext = new AudioCtx();

            audioSourceNode = audioContext.createMediaElementSource(audio);

            // Create 10-band peaking filters in series
            eqFilterNodes = EQ_FREQUENCIES.map((freq, idx) => {
                const filter = audioContext.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.2;
                filter.gain.value = state.eqValues[idx] || 0;
                return filter;
            });

            // Bass boost low-shelf filter at 90Hz
            bassBoostNode = audioContext.createBiquadFilter();
            bassBoostNode.type = 'lowshelf';
            bassBoostNode.frequency.value = 90;
            bassBoostNode.gain.value = (state.bassBoostValue / 100) * 12;

            // Master Gain node
            masterGainNode = audioContext.createGain();
            masterGainNode.gain.value = state.volume / 100;

            // Connect graph: source -> filters[0..9] -> bassBoost -> masterGain -> destination
            let previousNode = audioSourceNode;
            for (const filter of eqFilterNodes) {
                previousNode.connect(filter);
                previousNode = filter;
            }
            previousNode.connect(bassBoostNode);
            bassBoostNode.connect(masterGainNode);
            masterGainNode.connect(audioContext.destination);

            state.audioInitialized = true;
        } catch (e) {
            console.warn('Web Audio API could not initialize:', e);
        }
    }

    function applyEqPreset(presetName) {
        const gains = EQ_PRESETS[presetName];
        if (!gains) return;
        state.eqPreset = presetName;
        state.eqValues = [...gains];

        gains.forEach((gain, i) => {
            if (eqFilterNodes[i] && audioContext) {
                eqFilterNodes[i].gain.setTargetAtTime(gain, audioContext.currentTime, 0.05);
            }
            // Update slider UI
            const slider = document.getElementById(`eq-slider-${i}`);
            if (slider) slider.value = gain;
            const valLabel = document.getElementById(`eq-val-${i}`);
            if (valLabel) valLabel.textContent = (gain > 0 ? `+${gain}` : gain) + 'dB';
        });

        // Update active preset button style
        document.querySelectorAll('.eq-preset').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === presetName);
        });
    }

    function renderEqualizerSliders() {
        const container = document.getElementById('eq-sliders');
        if (!container) return;
        container.innerHTML = '';

        EQ_FREQUENCIES.forEach((freq, idx) => {
            const freqLabel = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            const currentGain = state.eqValues[idx] || 0;

            const bandDiv = document.createElement('div');
            bandDiv.className = 'eq-band';
            bandDiv.innerHTML = `
                <span class="eq-value" id="eq-val-${idx}">${currentGain > 0 ? '+' : ''}${currentGain}dB</span>
                <input type="range" class="eq-slider" id="eq-slider-${idx}" min="-12" max="12" step="1" value="${currentGain}">
                <label>${freqLabel}Hz</label>
            `;

            const slider = bandDiv.querySelector('input');
            slider.addEventListener('input', (e) => {
                initWebAudio();
                const val = parseFloat(e.target.value);
                state.eqValues[idx] = val;
                if (eqFilterNodes[idx] && audioContext) {
                    eqFilterNodes[idx].gain.setTargetAtTime(val, audioContext.currentTime, 0.05);
                }
                const label = document.getElementById(`eq-val-${idx}`);
                if (label) label.textContent = (val > 0 ? `+${val}` : val) + 'dB';

                // Deselect preset buttons if customized
                document.querySelectorAll('.eq-preset').forEach(b => b.classList.remove('active'));
                state.eqPreset = 'custom';
            });

            container.appendChild(bandDiv);
        });
    }

    // ==========================================
    // 6.5 YOUTUBE IFRAME PLAYER ENGINE
    // ==========================================
    let ytPlayer = null;
    let ytReady = false;
    let ytProgressInterval = null;
    let ytAudioFallbackRequest = -1;
    let ytAudioWatchdog = null;
    let ytReadyTimeout = null;
    let ytPlaybackFailed = false;
    let playbackWantsToPlay = false;

    let ytApiReady = Boolean(window.YT && typeof window.YT.Player === 'function');

    window.onYouTubeIframeAPIReady = function() {
        ytApiReady = Boolean(window.YT && typeof window.YT.Player === 'function');
        if (ytApiReady && state.pendingYtId) initializeYouTubePlayer();
    };

    function initializeYouTubePlayer() {
        if (ytPlayer || !ytApiReady || !state.pendingYtId) return;
        try {
            ytPlayer = new YT.Player('yt-player-target', {
                height: '240',
                width: '320',
                playerVars: {
                    'autoplay': 1,
                    'controls': 0,
                    'fs': 1,
                    'playsinline': 1,
                    'rel': 0,
                    'enablejsapi': 1,
                    'origin': location.origin
                },
                events: {
                    'onReady': () => {
                        clearTimeout(ytReadyTimeout);
                        ytReady = true;
                        setYouTubeVideoVisible(state.isYtVideoVisible);
                        const pending = state.pendingYtId;
                        state.pendingYtId = null;
                        if (pending && pending.request === playbackRequest && state.isYtPlaying) {
                            playYouTubeTrack(pending.videoId, pending.startSeconds, pending.shouldPlay);
                        }
                    },
                    'onStateChange': onYTStateChange,
                    'onError': onYTError,
                    'onAutoplayBlocked': () => {
                        if (!state.isYtPlaying) return;
                        state.isPlaying = false;
                        playbackWantsToPlay = false;
                        updatePlayButtons(false);
                        showToast('Press Play to start this track.', 'info');
                    }
                }
            });
        } catch(e) {
            console.warn('YouTube IFrame init error:', e);
            onYTError({ data: 'initialization' });
        }
    }

    function updateYouTubeVideoButton(visible) {
        const button = document.getElementById('yt-video-btn');
        if (!button) return;
        button.classList.toggle('active', visible);
        button.setAttribute('aria-pressed', String(visible));
        const label = visible ? 'Switch to audio only' : 'Show video';
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function setYouTubeVideoVisible(visible) {
        state.isYtVideoVisible = Boolean(visible);
        document.getElementById('app')?.classList.toggle('youtube-video-open', state.isYtVideoVisible);
        const host = document.getElementById('yt-player-host');
        host?.setAttribute('aria-hidden', String(!state.isYtVideoVisible));
        if (state.isYtVideoVisible) host?.removeAttribute('inert');
        else host?.setAttribute('inert', '');
        const iframe = ytPlayer?.getIframe?.();
        iframe?.setAttribute('tabindex', state.isYtVideoVisible ? '0' : '-1');
        updateYouTubeVideoButton(state.isYtVideoVisible);
    }

    function onYTStateChange(event) {
        if (!state.isYtPlaying || !state.currentSong) return;
        const expectedId = state.currentSong.ytId || String(state.currentSong.id).replace('yt-', '');
        const reportedId = ytPlayer?.getVideoData?.()?.video_id;
        if (reportedId && reportedId !== expectedId) return;
        if (event.data === YT.PlayerState.PLAYING) {
            ytPlaybackFailed = false;
            playbackWantsToPlay = true;
            state.isPlaying = true;
            state.isYtPlaying = true;
            updatePlayButtons(true);
            startYtProgressTimer();
        } else if (event.data === YT.PlayerState.PAUSED) {
            playbackWantsToPlay = false;
            state.isPlaying = false;
            updatePlayButtons(false);
        } else if (event.data === YT.PlayerState.ENDED) {
            state.isPlaying = false;
            updatePlayButtons(false);
            playNext(false);
        }
    }

    function onYTError(e) {
        if (!state.isYtPlaying) return;
        const reportedId = ytPlayer?.getVideoData?.()?.video_id;
        if (reportedId && reportedId !== getYouTubeId(state.currentSong)) return;
        clearTimeout(ytReadyTimeout);
        clearInterval(ytProgressInterval);
        ytPlaybackFailed = true;
        state.pendingYtId = null;
        playbackWantsToPlay = false;
        state.isPlaying = false;
        updatePlayButtons(false);
        console.warn('YouTube playback error:', e);
        showToast('This YouTube track is unavailable. Press Play to retry or choose another track.', 'error');
    }

    function getYouTubeId(song) {
        if (!song || !(song.source === 'youtube' || song.ytId || String(song.id).startsWith('yt-'))) return '';
        return song.ytId || String(song.id).replace(/^yt-/, '');
    }

    function clearYouTubeAudioWatchdog() {
        clearTimeout(ytAudioWatchdog);
        ytAudioWatchdog = null;
    }

    function watchYouTubeAudio(request = playbackRequest) {
        clearYouTubeAudioWatchdog();
        if (!getYouTubeId(state.currentSong) || state.isYtPlaying || !playbackWantsToPlay) return;
        ytAudioWatchdog = setTimeout(() => {
            if (request !== playbackRequest || !playbackWantsToPlay || state.isYtPlaying) return;
            fallbackToYouTube(request);
        }, 10000);
    }

    function openYouTubePlayer(ytId, startSeconds, shouldPlay) {
        clearYouTubeAudioWatchdog();
        state.isYtPlaying = true;
        ytPlaybackFailed = false;
        state.pendingYtId = { videoId: ytId, startSeconds, shouldPlay, request: playbackRequest };
        audio.pause();
        state.isPlaying = shouldPlay;
        playbackWantsToPlay = shouldPlay;
        setYouTubeVideoVisible(state.isYtVideoVisible);
        updatePlayButtons(shouldPlay);
        clearTimeout(ytReadyTimeout);
        if (ytReady && ytPlayer) {
            state.pendingYtId = null;
            playYouTubeTrack(ytId, startSeconds, shouldPlay);
        } else {
            const request = playbackRequest;
            ytReadyTimeout = setTimeout(() => {
                if (request === playbackRequest && state.isYtPlaying && !ytReady) onYTError({ data: 'timeout' });
            }, 10000);
            if (ytApiReady) initializeYouTubePlayer();
        }
    }

    function fallbackToYouTube(request = playbackRequest) {
        const ytId = getYouTubeId(state.currentSong);
        if (request !== playbackRequest || !ytId || state.isYtPlaying || !playbackWantsToPlay || ytAudioFallbackRequest === request) return false;
        ytAudioFallbackRequest = request;
        const startSeconds = audio.currentTime || state.currentTime || 0;
        openYouTubePlayer(ytId, startSeconds, true);
        // Cancel the failed download and its pending play promise after activating YouTube.
        audio.removeAttribute('src');
        audio.load();
        return true;
    }

    function startYtProgressTimer() {
        if (ytProgressInterval) clearInterval(ytProgressInterval);
        ytProgressInterval = setInterval(() => {
            if (!state.isYtPlaying || !ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
            const cur = ytPlayer.getCurrentTime() || 0;
            const dur = ytPlayer.getDuration() || state.currentSong?.duration || 1;
            state.currentTime = cur;
            state.duration = dur;

            const percent = Math.min(100, (cur / dur) * 100);
            const timeStr = formatTime(cur);
            const durStr = formatTime(dur);

            const currentTimeEl = document.getElementById('np-current-time');
            const durationEl = document.getElementById('np-duration');
            const progressFill = document.getElementById('progress-bar-fill');
            const fsCurrentTimeEl = document.getElementById('fs-current-time');
            const fsDurationEl = document.getElementById('fs-duration');
            const fsProgressFill = document.getElementById('fs-progress-fill');

            if (currentTimeEl) currentTimeEl.textContent = timeStr;
            if (durationEl && dur > 0) durationEl.textContent = durStr;
            if (fsCurrentTimeEl) fsCurrentTimeEl.textContent = timeStr;
            if (fsDurationEl && dur > 0) fsDurationEl.textContent = durStr;
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (fsProgressFill) fsProgressFill.style.width = `${percent}%`;
        }, 250);
    }

    function playYouTubeTrack(ytId, startSeconds = 0, shouldPlay = true) {
        if (!ytPlayer || !ytReady) {
            state.pendingYtId = { videoId: ytId, startSeconds, shouldPlay, request: playbackRequest };
            if (ytApiReady) initializeYouTubePlayer();
            return;
        }
        try {
            const video = { videoId: ytId, startSeconds };
            if (shouldPlay) {
                ytPlayer.loadVideoById(video);
                ytPlayer.playVideo();
            } else {
                ytPlayer.cueVideoById(video);
            }
            if (typeof ytPlayer.setVolume === 'function') {
                ytPlayer.setVolume(state.volume);
            }
        } catch(e) {
            console.warn('playYouTubeTrack error:', e);
            onYTError({ data: 'load' });
        }
    }

    function toggleYouTubeVideo() {
        const ytId = getYouTubeId(state.currentSong);
        if (!ytId) return;
        setYouTubeVideoVisible(!state.isYtVideoVisible);
        // Showing/hiding an active YouTube engine never changes its audio or position.
        if (state.isYtPlaying) {
            return;
        }
        const shouldPlay = state.isPlaying;
        const startSeconds = audio.currentTime || 0;
        openYouTubePlayer(ytId, startSeconds, shouldPlay);
    }

    // ==========================================
    // 7. CORE AUDIO PLAYBACK CONTROLLER
    // ==========================================
    let playbackRequest = 0;
    let continuationRequest = 0;

    async function playSong(song, autoPlay = true) {
        if (!song) return;
        const request = ++playbackRequest;
        clearYouTubeAudioWatchdog();
        clearTimeout(ytReadyTimeout);
        ytPlaybackFailed = false;
        ++continuationRequest;
        const selectedIndex = state.queue[state.queueIndex] === song
            ? state.queueIndex
            : state.queue.findIndex(item => String(item.id) === String(song.id));
        if (selectedIndex < 0) {
            state.queue = [song];
            state.queueIndex = 0;
            excludedRecommendations.clear();
            recommendationReserve = [];
            if (state.isShuffle) shuffleQueueIndices();
        } else {
            state.queueIndex = selectedIndex;
            if (state.isShuffle) {
                state.shufflePointer = state.shuffledIndices.indexOf(selectedIndex);
            }
        }
        state.currentSong = song;
        autoplaySuppressedForCurrent = null;
        loadRelatedSongs(song);

        // ── Check if this is a YouTube track ──
        const isYt = song.source === 'youtube' || song.ytId || String(song.id).startsWith('yt-');
        const ytId = song.ytId || String(song.id).replace('yt-', '');
        document.getElementById('app')?.classList.toggle('youtube-track-active', Boolean(isYt && ytId));

        // Keep YouTube audio in the same HTML media element as every other source.
        state.isYtPlaying = false;
        state.pendingYtId = null;
        setYouTubeVideoVisible(false);
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
            try { ytPlayer.pauseVideo(); } catch(e) {}
        }
        if (ytProgressInterval) clearInterval(ytProgressInterval);
        audio.pause();
        playbackWantsToPlay = autoPlay;
        state.currentTime = 0;

        let streamUrl = '';
        if (isYt && ytId) {
            streamUrl = `/api/yt/audio/${encodeURIComponent(ytId)}`;
        } else {
            // Lazy init Web Audio upon user gesture
            initWebAudio();
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
            streamUrl = getAudioStreamUrl(song, state.settings.streamingQuality);
        }
        if (!streamUrl) {
            showToast('Unable to find audio stream for this track', 'error');
            return;
        }

        audio.src = streamUrl;

        // Update recently played
        updateRecentlyPlayed(song);

        // Update UI
        updateNowPlayingUI(song);
        updateFullscreenUI(song);
        updateDynamicBackground(song);
        updateMediaSession(song);

        if (autoPlay) {
            if (isYt && ytId) watchYouTubeAudio(request);
            try {
                await audio.play();
                if (request !== playbackRequest || state.isYtPlaying || !playbackWantsToPlay) return;
                clearYouTubeAudioWatchdog();
                state.isPlaying = true;
                updatePlayButtons(true);
            } catch (err) {
                if (request !== playbackRequest || state.isYtPlaying) return;
                if (isYt && ytId && err.name !== 'NotAllowedError' && err.name !== 'AbortError' && fallbackToYouTube(request)) return;
                clearYouTubeAudioWatchdog();
                console.warn('Playback interrupted:', err);
                state.isPlaying = false;
                updatePlayButtons(false);
                if (err.name === 'NotAllowedError') showToast('Press play to start this track.', 'info');
            }
        }
    }

    function togglePlay() {
        ++continuationRequest;
        if (!state.currentSong) {
            if (state.queue.length > 0) {
                playSong(state.queue[0]);
            } else if (state.homeTrendingSongs?.length > 0) {
                setQueue(state.homeTrendingSongs, 0);
            }
            return;
        }

        // Toggle YouTube
        if (state.isYtPlaying) {
            const shouldPlay = !state.isPlaying;
            playbackWantsToPlay = shouldPlay;
            if (!ytReady || !ytPlayer) {
                if (state.pendingYtId) state.pendingYtId.shouldPlay = shouldPlay;
                else openYouTubePlayer(getYouTubeId(state.currentSong), state.currentTime || 0, shouldPlay);
                state.isPlaying = shouldPlay;
                updatePlayButtons(shouldPlay);
                return;
            }
            if (state.isPlaying) {
                try { ytPlayer.pauseVideo(); } catch(e) {}
                state.isPlaying = false;
                updatePlayButtons(false);
            } else {
                if (ytPlaybackFailed) playYouTubeTrack(getYouTubeId(state.currentSong), state.currentTime || 0, true);
                else try { ytPlayer.playVideo(); } catch(e) {}
                state.isPlaying = true;
                updatePlayButtons(true);
            }
            return;
        }

        // Toggle HTML5 Audio
        if (!audio.getAttribute('src') || audio.error) {
            playSong(state.currentSong);
            return;
        }
        initWebAudio();
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if (audio.paused) {
            const request = playbackRequest;
            playbackWantsToPlay = true;
            watchYouTubeAudio(request);
            audio.play().then(() => {
                if (request !== playbackRequest || state.isYtPlaying || !playbackWantsToPlay) return;
                clearYouTubeAudioWatchdog();
                state.isPlaying = true;
                updatePlayButtons(true);
            }).catch(e => {
                if (request !== playbackRequest || state.isYtPlaying) return;
                if (e.name !== 'NotAllowedError' && e.name !== 'AbortError' && fallbackToYouTube(request)) return;
                clearYouTubeAudioWatchdog();
                state.isPlaying = false;
                updatePlayButtons(false);
                console.error('Play error:', e);
            });
        } else {
            playbackWantsToPlay = false;
            clearYouTubeAudioWatchdog();
            audio.pause();
            state.isPlaying = false;
            updatePlayButtons(false);
        }
    }

    async function playNext(isManual = true) {
        if (state.queue.length === 0) return;
        const request = ++continuationRequest;
        const selectedSong = state.currentSong;

        // repeat-one only restarts on natural end, NOT manual next
        if (state.repeatMode === 'one' && state.currentSong && !isManual) {
            if (state.isYtPlaying && ytPlayer) {
                try { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); } catch(e) {}
            } else {
                audio.currentTime = 0;
                audio.play().catch(() => updatePlayButtons(false));
            }
            return;
        }

        let nextIdx = getNextQueueIndex();
        if (nextIdx < 0 && state.settings.autoplay &&
            autoplaySuppressedForCurrent !== String(selectedSong?.id)) {
            if (!recommendationTask && state.relatedSongs.length === 0) {
                loadRelatedSongs(selectedSong);
            }
            await recommendationTask;
            if (request !== continuationRequest || state.currentSong !== selectedSong || !state.settings.autoplay) return;
            appendRecommendations();
            nextIdx = getNextQueueIndex();
        }

        if (nextIdx < 0) {
            if (!isManual) {
                state.isPlaying = false;
                updatePlayButtons(false);
            }
            renderAutoplayStatus();
            return;
        }
        state.queueIndex = nextIdx;
        if (state.isShuffle) state.shufflePointer = state.shuffledIndices.indexOf(nextIdx);
        playSong(state.queue[nextIdx]);
        renderQueue();
    }

    function getNextQueueIndex() {
        if (state.isShuffle) {
            const next = state.shuffledIndices[state.shufflePointer + 1];
            if (next !== undefined) return next;
            if (state.repeatMode === 'all' && state.queue.length) {
                shuffleQueueIndices();
                // The current song anchors the new cycle; advance past it when another track exists.
                return state.shuffledIndices[state.queue.length > 1 ? 1 : 0];
            }
            return -1;
        }
        if (state.queueIndex + 1 < state.queue.length) return state.queueIndex + 1;
        return state.repeatMode === 'all' && state.queue.length ? 0 : -1;
    }

    function playPrevious() {
        ++continuationRequest;
        const curTime = state.isYtPlaying && ytPlayer ? (ytPlayer.getCurrentTime() || 0) : (audio.currentTime || 0);
        if (curTime > 3) {
            if (state.isYtPlaying && ytPlayer) {
                try { ytPlayer.seekTo(0, true); } catch(e) {}
            } else {
                audio.currentTime = 0;
            }
            return;
        }

        if (state.queue.length === 0) return;

        let prevIdx = state.queueIndex - 1;
        if (state.isShuffle) {
            state.shufflePointer = Math.max(0, state.shufflePointer - 1);
            prevIdx = state.shuffledIndices[state.shufflePointer];
        } else {
            if (prevIdx < 0) {
                prevIdx = state.repeatMode === 'all' ? state.queue.length - 1 : 0;
            }
        }

        state.queueIndex = prevIdx;
        playSong(state.queue[prevIdx]);
        renderQueue();
    }

    function seekTo(percentage) {
        if (state.isYtPlaying) {
            const dur = (ytReady ? ytPlayer?.getDuration?.() : 0) || state.currentSong?.duration || 0;
            if (dur > 0) {
                const targetSec = (percentage / 100) * dur;
                state.currentTime = targetSec;
                if (state.pendingYtId) state.pendingYtId.startSeconds = targetSec;
                else try { ytPlayer?.seekTo(targetSec, true); } catch(e) {}
            }
            return;
        }
        if (!audio.duration || isNaN(audio.duration)) return;
        audio.currentTime = (percentage / 100) * audio.duration;
    }

    function setVolume(val) {
        val = Math.max(0, Math.min(100, val));
        state.volume = val;
        state.isMuted = val === 0;

        if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
            try { ytPlayer.setVolume(val); } catch(e) {}
        }

        if (masterGainNode && audioContext) {
            masterGainNode.gain.setTargetAtTime(val / 100, audioContext.currentTime, 0.05);
        } else {
            audio.volume = val / 100;
        }

        // Update UI sliders & icons
        const slider = document.getElementById('volume-slider');
        if (slider) slider.value = val;

        const volBtn = document.getElementById('volume-btn');
        if (volBtn) {
            let icon = 'volume-up';
            if (val === 0) icon = 'volume-mute';
            else if (val < 40) icon = 'volume-down';
            volBtn.innerHTML = `<i class="fas fa-${icon}"></i>`;
        }
    }

    function toggleMute() {
        if (state.isMuted) {
            setVolume(state.previousVolume || 80);
        } else {
            state.previousVolume = state.volume;
            setVolume(0);
        }
    }

    function toggleShuffle() {
        state.isShuffle = !state.isShuffle;
        if (state.isShuffle) {
            shuffleQueueIndices();
        }
        const btn = document.getElementById('shuffle-btn');
        const fsBtn = document.getElementById('fs-shuffle');
        if (btn) btn.classList.toggle('active', state.isShuffle);
        if (fsBtn) fsBtn.classList.toggle('active', state.isShuffle);

        showToast(state.isShuffle ? 'Shuffle On' : 'Shuffle Off', 'info');
    }

    function toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentIdx = modes.indexOf(state.repeatMode);
        state.repeatMode = modes[(currentIdx + 1) % modes.length];

        const btn = document.getElementById('repeat-btn');
        const fsBtn = document.getElementById('fs-repeat');

        [btn, fsBtn].forEach(b => {
            if (!b) return;
            b.classList.remove('active');
            if (state.repeatMode === 'none') {
                b.innerHTML = '<i class="fas fa-redo"></i>';
            } else if (state.repeatMode === 'all') {
                b.classList.add('active');
                b.innerHTML = '<i class="fas fa-redo"></i>';
            } else if (state.repeatMode === 'one') {
                b.classList.add('active');
                b.innerHTML = '<i class="fas fa-redo-alt"></i>';
            }
        });

        const labels = { none: 'Repeat Off', all: 'Repeat All', one: 'Repeat One Track' };
        showToast(labels[state.repeatMode], 'info');
        appendRecommendations();
        renderAutoplayStatus();
    }

    // ==========================================
    // 8. QUEUE MANAGEMENT
    // ==========================================
    let recommendationGeneration = 0;
    let recommendationController = null;
    let recommendationTask = null;
    let autoplaySuppressedForCurrent = null;
    let recommendationReserve = [];
    const excludedRecommendations = new Set();

    function recommendationKeys(song) {
        const name = getSongTitle(song).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const artist = getArtistName(song).split(',')[0].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return [`id:${song.id}`, `track:${name}|${artist}`];
    }

    function uniqueRecommendations(songs) {
        const used = new Set(excludedRecommendations);
        [...state.queue, ...state.recentlyPlayed, state.currentSong].filter(Boolean).forEach(song => {
            recommendationKeys(song).forEach(key => used.add(key));
        });
        return (Array.isArray(songs) ? songs : []).filter(song => {
            if (!song?.id || (!getAudioStreamUrl(song) && !song.ytId && song.source !== 'youtube')) return false;
            const keys = recommendationKeys(song);
            if (keys.some(key => used.has(key))) return false;
            keys.forEach(key => used.add(key));
            return true;
        });
    }

    function upcomingQueueIndices() {
        return state.isShuffle
            ? state.shuffledIndices.slice(state.shufflePointer + 1)
            : state.queue.map((_, index) => index).slice(state.queueIndex + 1);
    }

    function renderAutoplayStatus() {
        const toggle = document.getElementById('autoplay-toggle');
        const status = document.getElementById('autoplay-status');
        if (toggle) toggle.checked = state.settings.autoplay;
        if (!status) return;
        if (!state.settings.autoplay) status.textContent = 'Playback stops when your queue ends.';
        else if (state.repeatMode !== 'none') status.textContent = 'Your repeat setting takes priority.';
        else if (autoplaySuppressedForCurrent === String(state.currentSong?.id)) status.textContent = 'Queue cleared. Play a track to start a new mix.';
        else if (!state.currentSong) status.textContent = 'Play a song and we’ll keep the music going.';
        else if (state.recommendationsLoading) status.textContent = 'Finding more music for you…';
        else if (state.recommendationsUnavailable && upcomingQueueIndices().length === 0) status.textContent = 'More music is unavailable right now. Try another track.';
        else status.textContent = 'Related songs continue after your queued tracks.';
    }

    function renderRelatedSongs() {
        const section = document.getElementById('related-section');
        const grid = document.getElementById('related-songs');
        const description = document.getElementById('related-description');
        if (section) section.hidden = !state.currentSong;
        if (description && state.currentSong) description.textContent = `Inspired by ${getSongTitle(state.currentSong)}`;
        if (!grid) return;
        grid._songs = state.relatedSongs;
        if (state.relatedSongs.length) {
            grid.innerHTML = state.relatedSongs.slice(0, 8).map(renderSongCardHtml).join('');
        } else {
            const message = state.recommendationsLoading
                ? 'Finding songs that fit this track…'
                : 'No related songs available right now. Try another song.';
            grid.innerHTML = `<div class="discovery-message" role="status">${message}</div>`;
        }
    }

    function cancelRecommendations() {
        ++recommendationGeneration;
        recommendationController?.abort();
        recommendationController = null;
        recommendationTask = null;
        state.recommendationsLoading = false;
    }

    function loadRelatedSongs(song) {
        if (!song) return Promise.resolve();
        cancelRecommendations();
        const generation = recommendationGeneration;
        const controller = new AbortController();
        recommendationController = controller;
        state.relatedSongs = [];
        state.recommendationsLoading = true;
        state.recommendationsUnavailable = false;
        renderRelatedSongs();
        renderAutoplayStatus();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const task = (async () => {
            try {
                let results = await API.getSongSuggestions(song.id, song, controller.signal);
                if (generation !== recommendationGeneration || state.currentSong !== song) return;
                results = uniqueRecommendations(results);
                // Already loaded discovery music is a last resort when a provider is unavailable.
                if (!results.length) results = uniqueRecommendations(state.homeTrendingSongs || []);
                state.relatedSongs = results;
                recommendationReserve = uniqueRecommendations([...recommendationReserve, ...results]).slice(0, 30);
                state.recommendationsUnavailable = results.length === 0;
                appendRecommendations();
            } catch (error) {
                if (generation === recommendationGeneration) state.recommendationsUnavailable = true;
            } finally {
                clearTimeout(timeout);
                if (generation === recommendationGeneration) {
                    recommendationController = null;
                    recommendationTask = null;
                    state.recommendationsLoading = false;
                    renderRelatedSongs();
                    renderAutoplayStatus();
                }
            }
        })();
        recommendationTask = task;
        return task;
    }

    function appendRecommendations() {
        if (!state.settings.autoplay || state.repeatMode !== 'none' ||
            autoplaySuppressedForCurrent === String(state.currentSong?.id) || upcomingQueueIndices().length > 2) return;
        const additions = uniqueRecommendations([...state.relatedSongs, ...recommendationReserve]).slice(0, 5);
        if (!additions.length) return;
        additions.forEach(song => {
            state.queue.push({ ...song, autoRecommended: true });
            if (state.isShuffle) state.shuffledIndices.push(state.queue.length - 1);
        });
        renderQueue();
    }

    function setAutoplay(enabled) {
        state.settings.autoplay = !!enabled;
        ++continuationRequest;
        saveStorage('bitgroove_settings', state.settings);
        if (enabled && state.currentSong) {
            autoplaySuppressedForCurrent = null;
            if (state.relatedSongs.length) appendRecommendations();
            else loadRelatedSongs(state.currentSong);
        } else if (!enabled) {
            // Keep manually queued music while removing future automatic additions.
            const remove = upcomingQueueIndices().filter(index => state.queue[index]?.autoRecommended).sort((a, b) => b - a);
            remove.forEach(index => removeFromQueue(index, false));
        }
        renderQueue();
        renderAutoplayStatus();
    }

    function setQueue(songs, startIndex = 0) {
        if (!Array.isArray(songs) || songs.length === 0) return;
        cancelRecommendations();
        excludedRecommendations.clear();
        recommendationReserve = [];
        state.queue = [...songs];
        state.queueIndex = Math.max(0, Math.min(startIndex, songs.length - 1));

        if (state.isShuffle) {
            shuffleQueueIndices();
        }

        playSong(state.queue[state.queueIndex]);
        renderQueue();
    }

    function addToQueue(song) {
        if (!song) return;
        const firstAutomatic = upcomingQueueIndices().find(index => state.queue[index]?.autoRecommended);
        const insertAt = firstAutomatic === undefined ? state.queue.length : firstAutomatic;
        state.queue.splice(insertAt, 0, { ...song, autoRecommended: false });
        if (insertAt <= state.queueIndex) state.queueIndex++;
        if (state.isShuffle) {
            state.shuffledIndices = state.shuffledIndices.map(index => index >= insertAt ? index + 1 : index);
            const firstAutoPosition = state.shuffledIndices.findIndex((index, position) => position > state.shufflePointer && state.queue[index]?.autoRecommended);
            state.shuffledIndices.splice(firstAutoPosition < 0 ? state.shuffledIndices.length : firstAutoPosition, 0, insertAt);
        }
        renderQueue();
        showToast(`Added "${getSongTitle(song)}" to queue`, 'success');
    }

    function addNextToQueue(song) {
        if (state.queue.length === 0) {
            setQueue([song], 0);
            return;
        }
        const insertAt = state.queueIndex + 1;
        state.queue.splice(insertAt, 0, { ...song, autoRecommended: false });
        if (state.isShuffle) {
            state.shuffledIndices = state.shuffledIndices.map(index => index >= insertAt ? index + 1 : index);
            state.shuffledIndices.splice(state.shufflePointer + 1, 0, insertAt);
        }
        renderQueue();
        showToast(`"${getSongTitle(song)}" will play next`, 'success');
    }

    function removeFromQueue(idx, rememberRemoval = true) {
        if (idx < 0 || idx >= state.queue.length) return;
        if (idx === state.queueIndex && state.currentSong) return;
        if (rememberRemoval) recommendationKeys(state.queue[idx]).forEach(key => excludedRecommendations.add(key));
        state.queue.splice(idx, 1);
        if (idx < state.queueIndex) {
            state.queueIndex--;
        }
        if (state.isShuffle) {
            state.shuffledIndices = state.shuffledIndices.filter(index => index !== idx).map(index => index > idx ? index - 1 : index);
            state.shufflePointer = state.shuffledIndices.indexOf(state.queueIndex);
        }
        renderQueue();
    }

    function clearQueue() {
        cancelRecommendations();
        ++continuationRequest;
        recommendationReserve = [];
        autoplaySuppressedForCurrent = String(state.currentSong?.id);
        if (state.currentSong) {
            state.queue = [state.currentSong];
            state.queueIndex = 0;
        } else {
            state.queue = [];
            state.queueIndex = -1;
        }
        state.shuffledIndices = state.currentSong ? [0] : [];
        state.shufflePointer = state.currentSong ? 0 : -1;
        renderQueue();
        showToast('Queue cleared', 'info');
    }

    function shuffleQueueIndices() {
        const count = state.queue.length;
        const indices = Array.from({ length: count }, (_, i) => i);
        // Fisher-Yates
        for (let i = count - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        // Place current song at the beginning of shuffle
        if (state.queueIndex >= 0) {
            const currentPos = indices.indexOf(state.queueIndex);
            if (currentPos > 0) {
                indices.splice(currentPos, 1);
                indices.unshift(state.queueIndex);
            }
        }
        state.shuffledIndices = indices;
        state.shufflePointer = 0;
    }

    function renderQueue() {
        renderAutoplayStatus();
        const queueList = document.getElementById('queue-list');
        const queueNowPlaying = document.getElementById('queue-now-playing');
        if (!queueList) return;

        // Render current song in header
        if (queueNowPlaying) {
            if (state.currentSong) {
                const img = getImageUrl(state.currentSong.image, 'https://placehold.co/80x80/1a1a2e/ffffff?text=♫');
                queueNowPlaying.innerHTML = `
                    <div style="font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Now Playing</div>
                    <div class="queue-item active" style="padding: 0;">
                        <div class="queue-item-artwork"><img src="${img}" alt=""></div>
                        <div class="queue-item-info">
                            <div class="queue-item-title">${escapeHtml(getSongTitle(state.currentSong))}</div>
                            <div class="queue-item-artist">${escapeHtml(getArtistName(state.currentSong))}</div>
                        </div>
                    </div>
                `;
            } else {
                queueNowPlaying.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Nothing playing right now</span>';
            }
        }

        // Render upcoming tracks
        queueList.innerHTML = '';
        const upcoming = upcomingQueueIndices();
        if (upcoming.length === 0) {
            queueList.innerHTML = '<div class="empty-state"><i class="fas fa-list-ol"></i><p>No upcoming tracks</p></div>';
            return;
        }

        upcoming.forEach(idx => {
            const song = state.queue[idx];
            if (!song) return;
            const img = getImageUrl(song.image, 'https://placehold.co/80x80/1a1a2e/ffffff?text=♫');
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.innerHTML = `
                <div class="queue-item-artwork"><img src="${img}" alt=""></div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${escapeHtml(getSongTitle(song))}</div>
                    <div class="queue-item-artist">${escapeHtml(getArtistName(song))}${song.autoRecommended ? ' · Autoplay' : ''}</div>
                </div>
                <button class="queue-item-remove" title="Remove"><i class="fas fa-times"></i></button>
            `;

            // Click item to jump to this track
            item.addEventListener('click', (e) => {
                if (e.target.closest('.queue-item-remove')) return;
                state.queueIndex = idx;
                playSong(song);
                renderQueue();
            });

            // Remove button
            item.querySelector('.queue-item-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromQueue(idx);
            });

            queueList.appendChild(item);
        });
    }

    // ==========================================
    // 9. UI UPDATES & SYNCHRONIZATION
    // ==========================================
    function updatePlayButtons(playing) {
        const mainBtn = document.getElementById('play-btn');
        const fsBtn = document.getElementById('fs-play');
        const fsArtworkContainer = document.querySelector('.fs-artwork-container');

        const icon = playing ? 'pause' : 'play';
        [mainBtn, fsBtn].forEach(button => {
            if (!button) return;
            button.innerHTML = `<i class="fas fa-${icon}" aria-hidden="true"></i>`;
            button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
            button.setAttribute('title', playing ? 'Pause' : 'Play');
        });

        if (fsArtworkContainer) {
            fsArtworkContainer.classList.toggle('playing', playing);
        }
    }

    function updateNowPlayingUI(song) {
        if (!song) return;
        const titleEl = document.getElementById('np-title');
        const artistEl = document.getElementById('np-artist');
        const artEl = document.getElementById('np-artwork');
        const artContainer = document.querySelector('.np-artwork-container');
        const likeBtn = document.getElementById('np-like-btn');
        const videoBtn = document.getElementById('yt-video-btn');
        const isYoutube = song.source === 'youtube' || song.ytId || String(song.id).startsWith('yt-');

        if (titleEl) titleEl.textContent = getSongTitle(song);
        if (artistEl) artistEl.textContent = `${getArtistName(song)}${song.isPreview ? ' · Preview' : ''}`;
        if (videoBtn) videoBtn.hidden = !isYoutube;

        const img = getImageUrl(song.image);
        if (img && artEl) {
            artEl.src = img;
            artContainer?.classList.add('has-art');
        } else {
            artContainer?.classList.remove('has-art');
        }

        const isFav = isFavorite(song.id);
        if (likeBtn) {
            likeBtn.classList.toggle('liked', isFav);
            likeBtn.innerHTML = `<i class="${isFav ? 'fas' : 'far'} fa-heart"></i>`;
        }
    }

    function updateFullscreenUI(song) {
        if (!song) return;
        const titleEl = document.getElementById('fs-title');
        const artistEl = document.getElementById('fs-artist');
        const albumEl = document.getElementById('fs-album');
        const artEl = document.getElementById('fs-artwork');
        const bgEl = document.getElementById('fs-bg');
        const likeBtn = document.getElementById('fs-like');

        if (titleEl) titleEl.textContent = getSongTitle(song);
        if (artistEl) artistEl.textContent = getArtistName(song);
        if (albumEl) albumEl.textContent = getAlbumTitle(song);

        const img = getImageUrl(song.image, 'https://placehold.co/600x600/12121a/ffffff?text=BitGroove');
        if (artEl) artEl.src = img;
        if (bgEl) bgEl.style.backgroundImage = `url(${img})`;

        const isFav = isFavorite(song.id);
        if (likeBtn) {
            likeBtn.classList.toggle('liked', isFav);
            likeBtn.innerHTML = `<i class="${isFav ? 'fas' : 'far'} fa-heart"></i>`;
        }
    }

    function updateDynamicBackground(song) {
        if (!state.settings.dynamicBg) return;
        const bg = document.getElementById('dynamic-bg');
        if (!bg || !song) return;
        const img = getImageUrl(song.image);
        if (img) {
            bg.style.backgroundImage = `url(${img})`;
            bg.style.opacity = '0.35';
        }
    }

    function updateMediaSession(song) {
        if (!('mediaSession' in navigator) || !song) return;
        const img = getImageUrl(song.image, '');
        navigator.mediaSession.metadata = new MediaMetadata({
            title: getSongTitle(song),
            artist: getArtistName(song),
            album: getAlbumTitle(song),
            artwork: img ? [
                { src: img, sizes: '96x96', type: 'image/jpeg' },
                { src: img, sizes: '128x128', type: 'image/jpeg' },
                { src: img, sizes: '256x256', type: 'image/jpeg' },
                { src: img, sizes: '512x512', type: 'image/jpeg' }
            ] : []
        });

        navigator.mediaSession.setActionHandler('play', () => { if (!state.isPlaying) togglePlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { if (state.isPlaying) togglePlay(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNext(true));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                if (state.isYtPlaying && ytPlayer) {
                    try { ytPlayer.seekTo(details.seekTime, true); } catch(e) {}
                } else {
                    audio.currentTime = details.seekTime;
                }
            }
        });
    }

    // ==========================================
    // 10. PAGE ROUTING & NAVIGATION
    // ==========================================
    function setMobileNavigation(open) {
        document.getElementById('sidebar')?.classList.toggle('mobile-open', open);
        document.getElementById('mobile-nav-backdrop')?.classList.toggle('active', open);
        const button = document.getElementById('mobile-menu-btn');
        button?.setAttribute('aria-expanded', String(open));
        button?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    }

    function navigateTo(pageId, extraData = null) {
        const pages = document.querySelectorAll('.page');
        pages.forEach(p => p.classList.remove('active'));

        const target = document.getElementById(`page-${pageId}`);
        if (!target) return;
        target.classList.add('active');
        setMobileNavigation(false);

        // Update sidebar nav items
        document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-footer .nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageId);
        });

        state.currentPage = pageId;

        // History handling
        if (state.pageHistory[state.historyIndex] !== pageId) {
            state.pageHistory = state.pageHistory.slice(0, state.historyIndex + 1);
            state.pageHistory.push(pageId);
            state.historyIndex++;
        }

        // Scroll to top
        const pageContent = document.getElementById('page-content');
        if (pageContent) pageContent.scrollTop = 0;

        // Dynamic page loaders
        if (pageId === 'favorites') renderFavoritesPage();
        if (pageId === 'playlists') renderPlaylistsPage();
        if (pageId === 'recent') renderRecentPage();
        if (pageId === 'downloads') renderDownloadsPage();
        if (pageId === 'trending') renderTrendingPage();
        if (pageId === 'charts') renderChartsPage();

        if (pageId === 'album-detail' && extraData) renderAlbumDetailPage(extraData);
        if (pageId === 'artist-detail' && extraData) renderArtistDetailPage(extraData);
        if (pageId === 'playlist-detail' && extraData) renderPlaylistDetailPage(extraData);
    }

    function goBack() {
        if (state.historyIndex > 0) {
            state.historyIndex--;
            const prev = state.pageHistory[state.historyIndex];
            navigateTo(prev);
        }
    }

    function goForward() {
        if (state.historyIndex < state.pageHistory.length - 1) {
            state.historyIndex++;
            const next = state.pageHistory[state.historyIndex];
            navigateTo(next);
        }
    }

    // ==========================================
    // 11. HTML COMPONENT RENDERERS
    // ==========================================
    function renderSongCardHtml(song) {
        const img = getImageUrl(song.image, 'https://placehold.co/300x300/12121a/ffffff?text=♫');
        const title = escapeHtml(getSongTitle(song));
        const artist = escapeHtml(getArtistName(song));

        return `
            <div class="song-card" data-song-id="${escapeHtml(song.id)}" tabindex="0" role="button" aria-label="Play ${title}">
                <div class="song-card-artwork">
                    <img src="${escapeHtml(img)}" alt="${title}" loading="lazy">
                    <span class="card-play-overlay" aria-hidden="true"><i class="fas fa-play"></i></span>
                </div>
                <div class="song-card-title" title="${title}">${title}</div>
                <div class="song-card-artist" title="${artist}">${artist}</div>
            </div>
        `;
    }

    function renderAlbumCardHtml(album) {
        const img = getImageUrl(album.image, 'https://placehold.co/300x300/12121a/ffffff?text=Album');
        const title = escapeHtml(decodeHtmlEntities(album.name || album.title || 'Album'));
        const subtitle = escapeHtml(decodeHtmlEntities(album.artist || album.primaryArtists || album.year || 'Album'));

        return `
            <div class="album-card" data-album-id="${escapeHtml(album.id)}" tabindex="0" role="button" aria-label="Open ${title}">
                <div class="album-card-artwork">
                    <img src="${escapeHtml(img)}" alt="${title}" loading="lazy">
                    <span class="card-play-overlay" aria-hidden="true"><i class="fas fa-play"></i></span>
                </div>
                <div class="album-card-title" title="${title}">${title}</div>
                <div class="album-card-subtitle" title="${subtitle}">${subtitle}</div>
            </div>
        `;
    }

    function renderArtistCardHtml(artist) {
        const img = getImageUrl(artist.image, 'https://placehold.co/300x300/12121a/ffffff?text=Artist');
        const name = escapeHtml(decodeHtmlEntities(artist.name || 'Artist'));

        return `
            <div class="artist-card" data-artist-id="${escapeHtml(artist.id)}" tabindex="0" role="button" aria-label="Explore ${name}">
                <div class="artist-card-artwork">
                    <img src="${escapeHtml(img)}" alt="${name}" loading="lazy">
                </div>
                <div class="artist-card-name" title="${name}">${name}</div>
            </div>
        `;
    }

    function renderPlaylistCardHtml(playlist) {
        const img = getImageUrl(playlist.image, 'https://placehold.co/300x300/12121a/ffffff?text=Playlist');
        const title = escapeHtml(decodeHtmlEntities(playlist.name || playlist.title || 'Playlist'));
        const subtitle = escapeHtml(decodeHtmlEntities(playlist.songCount ? `${playlist.songCount} Songs` : (playlist.description || 'Curated')));

        return `
            <div class="playlist-card" data-playlist-id="${escapeHtml(playlist.id)}" tabindex="0" role="button" aria-label="Open ${title}">
                <div class="playlist-card-artwork">
                    <img src="${escapeHtml(img)}" alt="${title}" loading="lazy">
                    <span class="card-play-overlay" aria-hidden="true"><i class="fas fa-play"></i></span>
                </div>
                <div class="playlist-card-title" title="${title}">${title}</div>
                <div class="playlist-card-subtitle" title="${subtitle}">${subtitle}</div>
            </div>
        `;
    }

    function renderQuickPickCardHtml(song) {
        const img = getImageUrl(song.image, 'https://placehold.co/80x80/12121a/ffffff?text=♫');
        const title = escapeHtml(getSongTitle(song));
        const artist = escapeHtml(getArtistName(song));

        return `
            <div class="quick-pick-card" data-song-id="${escapeHtml(song.id)}" tabindex="0" role="button" aria-label="Play ${title}">
                <div class="quick-pick-artwork"><img src="${escapeHtml(img)}" alt="${title}" loading="lazy"></div>
                <div class="quick-pick-info">
                    <div class="quick-pick-title" title="${title}">${title}</div>
                    <div class="quick-pick-artist" title="${artist}">${artist}</div>
                </div>
            </div>
        `;
    }

    function renderSongRowHtml(song, index, playlistContext = null) {
        const isCurrent = state.currentSong && state.currentSong.id === song.id;
        const isFav = isFavorite(song.id);
        const img = getImageUrl(song.image, 'https://placehold.co/80x80/12121a/ffffff?text=♫');
        const title = getSongTitle(song);
        const artist = getArtistName(song);
        const album = getAlbumTitle(song);
        const duration = formatTime(song.duration);

        // Source badge
        const srcMap = {
            'jiosaavn': ['🎵', 'JioSaavn', '#00bfa5'],
            'deezer':  ['🎸', 'Deezer', '#a259ff'],
            'youtube': ['▶️', 'YouTube', '#ff0000'],
            'audius':  ['🎵', 'Audius', '#7e1bcc'],
            'itunes':  ['🍎', 'iTunes', '#fc3c44']
        };
        let srcBadge = '';
        const src = song.source || (song.id?.startsWith('deezer-') ? 'deezer' : song.id?.startsWith('yt-') ? 'youtube' : song.id?.startsWith('audius-') ? 'audius' : song.id?.startsWith('itunes-') ? 'itunes' : '');
        if (src && srcMap[src]) {
            const [icon, label, color] = srcMap[src];
            srcBadge = `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${color}22;color:${color};border:1px solid ${color}44;margin-left:4px;vertical-align:middle;">${icon} ${label}${song.isPreview ? ' · Preview' : ''}</span>`;
        }

        return `
            <div class="song-row ${isCurrent ? 'playing' : ''}" data-song-id="${song.id}" data-index="${index}">
                <div class="song-row-number">
                    <span class="num">${index + 1}</span>
                    <i class="fas fa-play play-icon"></i>
                </div>
                <div class="song-row-info">
                    <div class="song-row-artwork"><img src="${img}" alt="" loading="lazy"></div>
                    <div class="song-row-details">
                        <div class="song-row-title">${title}${srcBadge}</div>
                        <div class="song-row-artist">${artist}</div>
                    </div>
                </div>
                <div class="song-row-album">${album}</div>
                <div class="song-row-duration">${duration}</div>
                <div class="song-row-actions">
                    <button class="song-action-btn like-btn ${isFav ? 'liked' : ''}" title="Favorite">
                        <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
                    </button>
                    <button class="song-action-btn more-btn" title="More Options">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>
        `;
    }

    // ==========================================
    // 12. HOME PAGE POPULATION
    // ==========================================
    function renderDiscoveryState(container, message, retry = false) {
        if (!container) return;
        container.innerHTML = `<div class="discovery-state" role="status"><p>${escapeHtml(message)}</p>${retry ? '<button class="btn-secondary" data-retry-discovery>Try again</button>' : ''}</div>`;
    }

    function setDiscoveryItems(container, items, renderer, kind, emptyMessage) {
        if (!container) return;
        container[`_${kind}`] = items;
        if (!items.length) {
            renderDiscoveryState(container, emptyMessage, true);
            return;
        }
        container.innerHTML = items.map(renderer).join('');
    }

    let homeRequestId = 0;
    async function loadHomePage() {
        const requestId = ++homeRequestId;
        const quickPicks = document.getElementById('quick-picks');
        const trending = document.getElementById('trending-songs');
        const releases = document.getElementById('new-releases');
        const charts = document.getElementById('top-charts');
        const playlists = document.getElementById('top-playlists');
        const artists = document.getElementById('top-artists');
        [quickPicks, trending, releases, charts, playlists, artists].forEach(container => renderDiscoveryState(container, 'Finding fresh music?'));
        const modules = await API.getModules(state.settings.languages.join(','));
        if (requestId !== homeRequestId) return;
        state.homeModules = modules || {};
        let songs = modules?.trending?.songs || modules?.new_trending || [];
        const albums = modules?.albums || modules?.new_albums || [];
        setDiscoveryItems(releases, albums, renderAlbumCardHtml, 'albums', 'New releases are temporarily unavailable.');
        setDiscoveryItems(charts, modules?.charts || [], renderPlaylistCardHtml, 'playlists', 'Charts are temporarily unavailable.');
        setDiscoveryItems(playlists, modules?.playlists || modules?.featuredPlaylists || [], renderPlaylistCardHtml, 'playlists', 'Featured playlists are temporarily unavailable.');
        // Keep the visible sections independent when a provider temporarily omits a module.
        await Promise.allSettled([
            (async () => {
                if (!songs.length) {
                    try {
                        const response = await API.request('/api/deezer/charts');
                        songs = response.data?.results || [];
                    } catch (error) { }
                }
                if (requestId !== homeRequestId) return;
                state.homeTrendingSongs = songs;
                setDiscoveryItems(quickPicks, songs.slice(0, 6), renderQuickPickCardHtml, 'songs', 'Quick picks are temporarily unavailable.');
                setDiscoveryItems(trending, songs, renderSongCardHtml, 'songs', 'Trending music is temporarily unavailable.');
                state.homeModules.trending = { songs };
                const seenArtists = new Set();
                const artistItems = modules?.artists?.length ? modules.artists : songs.reduce((result, song) => {
                    const name = getArtistName(song).split(',')[0].trim();
                    if (!name || seenArtists.has(name.toLowerCase())) return result;
                    seenArtists.add(name.toLowerCase());
                    result.push({id: `search-${name}`, name, image: song.image, searchQuery: name});
                    return result;
                }, []).slice(0, 12);
                state.homeModules.artists = artistItems;
                setDiscoveryItems(artists, artistItems, renderArtistCardHtml, 'artists', 'Artists will appear when discovery is available.');
            })()
        ]);
        if (requestId !== homeRequestId) return;
        state.homeModules.albums = albums;
    }

    function showDiscoveryCollection(kind) {
        state.discoveryCollection = kind;
        if (kind === 'trending') { navigateTo('trending'); return; }
        if (kind === 'charts') { navigateTo('charts'); return; }
        const modules = state.homeModules || {};
        const title = document.getElementById('discover-title');
        const grid = document.getElementById('discover-grid');
        navigateTo('discover');
        if (kind === 'releases') {
            if (title) title.textContent = 'New Releases';
            setDiscoveryItems(grid, modules.albums || [], renderAlbumCardHtml, 'albums', 'New releases are temporarily unavailable.');
        } else if (kind === 'artists') {
            if (title) title.textContent = 'Artists to Explore';
            setDiscoveryItems(grid, modules.artists || [], renderArtistCardHtml, 'artists', 'Artists are temporarily unavailable.');
        } else {
            if (title) title.textContent = 'Featured Playlists';
            setDiscoveryItems(grid, modules.playlists || [], renderPlaylistCardHtml, 'playlists', 'Featured playlists are temporarily unavailable.');
        }
    }

    async function retryDiscovery() {
        const page = state.currentPage;
        const collection = state.discoveryCollection;
        await loadHomePage();
        if (state.currentPage !== page) return;
        if (page === 'charts') await renderChartsPage();
        else if (page === 'trending') await renderTrendingPage();
        else if (page === 'discover') showDiscoveryCollection(collection);
    }

    // ==========================================
    // 13. SEARCH CONTROLLER
    // ==========================================
    let searchRequestId = 0;
    let searchController = null;
    let searchDebounceTimer = null;

    function performSearch(query) {
        const requestId = ++searchRequestId;
        clearTimeout(searchDebounceTimer);
        searchController?.abort();
        query = String(query || '').trim();
        const filter = state.searchFilter;
        const resultsContainer = document.getElementById('search-results');
        if (!resultsContainer) return;
        state.lastSearchResults = [];
        resultsContainer._songs = [];

        if (!query) {
            searchController = null;
            showLoading(false);
            resultsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>Search for your favorite songs, artists, or albums</p></div>';
            return;
        }

        const controller = new AbortController();
        searchController = controller;
        searchDebounceTimer = setTimeout(async () => {
            const isCurrent = () => requestId === searchRequestId && !controller.signal.aborted && state.searchFilter === filter;
            if (!isCurrent()) return;
            showLoading(true);
            try {
                let items = [];
                if (filter === 'songs') items = await API.searchSongs(query, 0, 30, controller.signal);
                else if (filter === 'youtube') items = await API.searchYouTube(query);
                else if (filter === 'albums') items = await API.searchAlbums(query);
                else if (filter === 'artists') items = await API.searchArtists(query);
                else if (filter === 'playlists') items = await API.searchPlaylists(query);
                if (!isCurrent()) return;
                if (!items.length) {
                    resultsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>No ${escapeHtml(filter)} found for &quot;${escapeHtml(query)}&quot;</p></div>`;
                    return;
                }
                if (filter === 'songs' || filter === 'youtube') {
                    resultsContainer.innerHTML = `<div class="song-list" id="search-song-list">${items.map((song, index) => renderSongRowHtml(song, index)).join('')}</div>`;
                    const list = document.getElementById('search-song-list');
                    if (list) list._songs = items;
                    resultsContainer._songs = items;
                    state.lastSearchResults = items;
                } else {
                    const renderer = filter === 'albums' ? renderAlbumCardHtml : filter === 'artists' ? renderArtistCardHtml : renderPlaylistCardHtml;
                    resultsContainer.innerHTML = `<div class="search-results-grid">${items.map(renderer).join('')}</div>`;
                    resultsContainer[`_${filter}`] = items;
                }
            } catch (error) {
                if (isCurrent()) resultsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Could not load results. Try searching again.</p></div>';
            } finally {
                if (isCurrent()) showLoading(false);
            }
        }, 350);
    }

    // ==========================================
    // 14. DETAIL PAGES (ALBUM, ARTIST, PLAYLIST)
    // ==========================================
    let albumDetailRequestId = 0;
    async function renderAlbumDetailPage(albumData) {
        const requestId = ++albumDetailRequestId;
        const header = document.getElementById('album-detail-header');
        const songList = document.getElementById('album-songs-list');
        if (!header || !songList) return;
        showLoading(true);
        header.innerHTML = '';
        songList._songs = [];
        renderDiscoveryState(songList, 'Loading album…');

        try {
            const album = typeof albumData === 'object' && Array.isArray(albumData.songs)
                ? albumData : await API.getAlbum(typeof albumData === 'object' ? albumData.id : albumData);
            if (requestId !== albumDetailRequestId) return;
            if (!album) {
                showToast('Failed to load album', 'error');
                renderDiscoveryState(songList, 'This album is temporarily unavailable. Try another release.');
                return;
            }

            const img = getImageUrl(album.image, 'https://placehold.co/300x300/12121a/ffffff?text=Album');
            const songs = album.songs || [];

            header.innerHTML = `
                <div class="detail-artwork"><img src="${img}" alt="${album.name}"></div>
                <div class="detail-info">
                    <div class="detail-type">Album</div>
                    <h1 class="detail-title">${decodeHtmlEntities(album.name)}</h1>
                    <div class="detail-subtitle">${decodeHtmlEntities(album.primaryArtists || album.artist || '')}</div>
                    <div class="detail-meta">${album.year || ''} • ${songs.length} Tracks</div>
                    <div class="detail-actions">
                        <button class="btn-primary" id="album-play-all"><i class="fas fa-play"></i> Play All</button>
                        <button class="btn-secondary" id="album-shuffle"><i class="fas fa-random"></i> Shuffle</button>
                    </div>
                </div>
            `;

            songList.innerHTML = songs.length ? songs.map((s, idx) => renderSongRowHtml(s, idx)).join('') : '<div class="discovery-state"><p>No playable tracks are available for this album.</p></div>';
            songList._songs = songs;

            document.getElementById('album-play-all')?.addEventListener('click', () => {
                if (songs.length > 0) setQueue(songs, 0);
            });
            document.getElementById('album-shuffle')?.addEventListener('click', () => {
                if (songs.length > 0) {
                    state.isShuffle = true;
                    setQueue(songs, 0);
                }
            });
        } catch (e) {
            if (requestId === albumDetailRequestId) {
                console.error('Album detail error:', e);
                renderDiscoveryState(songList, 'This album is temporarily unavailable. Try another release.');
            }
        } finally {
            if (requestId === albumDetailRequestId) showLoading(false);
        }
    }

    async function renderArtistDetailPage(artistId) {
        showLoading(true);
        const header = document.getElementById('artist-detail-header');
        const content = document.getElementById('artist-detail-content');
        if (!header || !content) return;

        try {
            const artist = await API.getArtist(artistId);
            if (!artist) {
                showToast('Failed to load artist', 'error');
                return;
            }

            const img = getImageUrl(artist.image, 'https://placehold.co/300x300/12121a/ffffff?text=Artist');
            const topSongs = artist.topSongs || [];
            const topAlbums = artist.topAlbums || [];

            header.innerHTML = `
                <div class="artist-detail-artwork"><img src="${img}" alt="${artist.name}"></div>
                <h1 class="artist-detail-name">${decodeHtmlEntities(artist.name)}</h1>
                <div class="artist-detail-fans">${artist.followerCount ? `${Number(artist.followerCount).toLocaleString()} Followers` : 'Verified Artist'}</div>
                <div class="detail-actions" style="justify-content: center;">
                    <button class="btn-primary" id="artist-play-all"><i class="fas fa-play"></i> Play Top Songs</button>
                </div>
            `;

            content.innerHTML = `
                <section class="section">
                    <h2 class="section-title">Top Songs</h2>
                    <div class="song-list" id="artist-songs-list">
                        ${topSongs.map((s, idx) => renderSongRowHtml(s, idx)).join('')}
                    </div>
                </section>
                ${topAlbums.length > 0 ? `
                <section class="section">
                    <h2 class="section-title">Discography</h2>
                    <div class="horizontal-scroll">
                        ${topAlbums.map(a => renderAlbumCardHtml(a)).join('')}
                    </div>
                </section>` : ''}
            `;

            const songListEl = document.getElementById('artist-songs-list');
            if (songListEl) songListEl._songs = topSongs;

            document.getElementById('artist-play-all')?.addEventListener('click', () => {
                if (topSongs.length > 0) setQueue(topSongs, 0);
            });
        } catch (e) {
            console.error('Artist detail error:', e);
        } finally {
            showLoading(false);
        }
    }

    let playlistDetailRequestId = 0;
    async function renderPlaylistDetailPage(playlistData) {
        const requestId = ++playlistDetailRequestId;
        const header = document.getElementById('playlist-detail-header');
        const songList = document.getElementById('playlist-songs-list');
        if (!header || !songList) return;
        showLoading(true);
        header.innerHTML = '';
        songList._songs = [];
        renderDiscoveryState(songList, 'Loading playlist…');

        try {
            let playlist = playlistData;
            // If it's a string ID, fetch online playlist
            if (typeof playlistData !== 'object' || !Array.isArray(playlistData.songs)) {
                playlist = await API.getPlaylist(typeof playlistData === 'object' ? playlistData.id : playlistData);
            }
            if (requestId !== playlistDetailRequestId) return;

            if (!playlist) {
                showToast('Failed to load playlist', 'error');
                renderDiscoveryState(songList, 'This playlist is temporarily unavailable. Try another playlist.');
                return;
            }

            const img = getImageUrl(playlist.image, 'https://placehold.co/300x300/12121a/ffffff?text=Playlist');
            const songs = playlist.songs || [];

            header.innerHTML = `
                <div class="detail-artwork"><img src="${img}" alt="${playlist.name}"></div>
                <div class="detail-info">
                    <div class="detail-type">Playlist</div>
                    <h1 class="detail-title">${decodeHtmlEntities(playlist.name)}</h1>
                    <div class="detail-subtitle">${decodeHtmlEntities(playlist.description || '')}</div>
                    <div class="detail-meta">${songs.length} Tracks</div>
                    <div class="detail-actions">
                        <button class="btn-primary" id="playlist-play-all"><i class="fas fa-play"></i> Play All</button>
                        <button class="btn-secondary" id="playlist-shuffle"><i class="fas fa-random"></i> Shuffle</button>
                    </div>
                </div>
            `;

            songList.innerHTML = songs.length > 0
                ? songs.map((s, idx) => renderSongRowHtml(s, idx)).join('')
                : '<div class="empty-state"><i class="fas fa-music"></i><p>No songs in this playlist yet</p></div>';
            songList._songs = songs;

            document.getElementById('playlist-play-all')?.addEventListener('click', () => {
                if (songs.length > 0) setQueue(songs, 0);
            });
            document.getElementById('playlist-shuffle')?.addEventListener('click', () => {
                if (songs.length > 0) {
                    state.isShuffle = true;
                    setQueue(songs, 0);
                }
            });
        } catch (e) {
            if (requestId === playlistDetailRequestId) {
                console.error('Playlist detail error:', e);
                renderDiscoveryState(songList, 'This playlist is temporarily unavailable. Try another playlist.');
            }
        } finally {
            if (requestId === playlistDetailRequestId) showLoading(false);
        }
    }

    // ==========================================
    // 15. FAVORITES & PLAYLISTS MANAGEMENT
    // ==========================================
    function isFavorite(songId) {
        return state.favorites.some(s => s.id === songId);
    }

    function toggleFavorite(song) {
        if (!song) return;
        const idx = state.favorites.findIndex(s => s.id === song.id);
        if (idx >= 0) {
            state.favorites.splice(idx, 1);
            showToast(`Removed "${getSongTitle(song)}" from Favorites`, 'info');
        } else {
            state.favorites.unshift(song);
            showToast(`Added "${getSongTitle(song)}" to Favorites`, 'success');
        }
        saveStorage('bitgroove_favorites', state.favorites);

        // Update UI hearts
        updateNowPlayingUI(state.currentSong);
        updateFullscreenUI(state.currentSong);

        // Update song rows if rendered
        document.querySelectorAll(`.song-row[data-song-id="${song.id}"] .like-btn`).forEach(btn => {
            const fav = isFavorite(song.id);
            btn.classList.toggle('liked', fav);
            btn.innerHTML = `<i class="${fav ? 'fas' : 'far'} fa-heart"></i>`;
        });

        if (state.currentPage === 'favorites') {
            renderFavoritesPage();
        }
    }

    function renderFavoritesPage() {
        const list = document.getElementById('favorites-list');
        if (!list) return;

        if (state.favorites.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-heart"></i>
                    <p>No favorites yet. Like songs while listening to add them here.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="detail-actions" style="margin-bottom: 20px;">
                <button class="btn-primary" id="fav-play-all"><i class="fas fa-play"></i> Play All</button>
                <button class="btn-secondary" id="fav-shuffle"><i class="fas fa-random"></i> Shuffle</button>
            </div>
            ${state.favorites.map((s, idx) => renderSongRowHtml(s, idx)).join('')}
        `;
        list._songs = state.favorites;

        document.getElementById('fav-play-all')?.addEventListener('click', () => {
            setQueue(state.favorites, 0);
        });
        document.getElementById('fav-shuffle')?.addEventListener('click', () => {
            state.isShuffle = true;
            setQueue(state.favorites, 0);
        });
    }

    function renderPlaylistsPage() {
        const grid = document.getElementById('playlists-grid');
        if (!grid) return;

        if (state.playlists.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-list-ul"></i>
                    <p>No playlists yet. Click "Create Playlist" to start your collection!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = state.playlists.map(pl => {
            const firstSongImg = pl.songs?.[0] ? getImageUrl(pl.songs[0].image) : null;
            const img = firstSongImg || 'https://placehold.co/300x300/12121a/ffffff?text=Playlist';
            return `
                <div class="playlist-card" data-local-playlist-id="${pl.id}">
                    <div class="playlist-card-artwork">
                        <img src="${img}" alt="${pl.name}">
                        <button class="card-play-overlay"><i class="fas fa-play"></i></button>
                    </div>
                    <div class="playlist-card-title">${decodeHtmlEntities(pl.name)}</div>
                    <div class="playlist-card-subtitle">${pl.songs?.length || 0} Songs</div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.playlist-card').forEach(card => {
            card.addEventListener('click', () => {
                const plId = card.dataset.localPlaylistId;
                const found = state.playlists.find(p => p.id === plId);
                if (found) navigateTo('playlist-detail', found);
            });
        });
    }

    function renderSidebarPlaylists() {
        const container = document.getElementById('user-playlists-list');
        if (!container) return;
        container.innerHTML = state.playlists.map(pl => `
            <div class="user-playlist-item" data-pl-id="${pl.id}">
                <i class="fas fa-music"></i>
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${decodeHtmlEntities(pl.name)}</span>
            </div>
        `).join('');

        container.querySelectorAll('.user-playlist-item').forEach(item => {
            item.addEventListener('click', () => {
                const found = state.playlists.find(p => p.id === item.dataset.plId);
                if (found) navigateTo('playlist-detail', found);
            });
        });
    }

    function createPlaylist(name, description = '') {
        name = name.trim();
        if (!name) return;
        const newPl = {
            id: generateId(),
            name,
            description,
            songs: []
        };
        state.playlists.push(newPl);
        saveStorage('bitgroove_playlists', state.playlists);
        renderSidebarPlaylists();
        if (state.currentPage === 'playlists') renderPlaylistsPage();
        showToast(`Created playlist "${name}"`, 'success');
    }

    function addSongToUserPlaylist(playlistId, song) {
        const pl = state.playlists.find(p => p.id === playlistId);
        if (!pl) return;
        if (pl.songs.some(s => s.id === song.id)) {
            showToast(`"${getSongTitle(song)}" is already in ${pl.name}`, 'info');
            return;
        }
        pl.songs.push(song);
        saveStorage('bitgroove_playlists', state.playlists);
        showToast(`Added to "${pl.name}"`, 'success');
    }

    // ==========================================
    // 16. RECENTLY PLAYED & DOWNLOADS
    // ==========================================
    function updateRecentlyPlayed(song) {
        if (!song) return;
        state.recentlyPlayed = state.recentlyPlayed.filter(s => s.id !== song.id);
        state.recentlyPlayed.unshift(song);
        if (state.recentlyPlayed.length > 50) {
            state.recentlyPlayed = state.recentlyPlayed.slice(0, 50);
        }
        saveStorage('bitgroove_recent', state.recentlyPlayed);
    }

    function renderRecentPage() {
        const list = document.getElementById('recent-list');
        if (!list) return;

        if (state.recentlyPlayed.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <p>No listening history yet. Start playing your favorite jams!</p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="detail-actions" style="margin-bottom: 20px;">
                <button class="btn-primary" id="recent-play-all"><i class="fas fa-play"></i> Play History</button>
            </div>
            ${state.recentlyPlayed.map((s, idx) => renderSongRowHtml(s, idx)).join('')}
        `;
        list._songs = state.recentlyPlayed;

        document.getElementById('recent-play-all')?.addEventListener('click', () => {
            setQueue(state.recentlyPlayed, 0);
        });
    }

    function renderDownloadsPage() {
        const list = document.getElementById('downloads-list');
        if (!list) return;

        if (state.downloads.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-download"></i>
                    <p>No downloaded songs. Click the download icon on any track to save for offline!</p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="detail-actions" style="margin-bottom: 20px;">
                <button class="btn-primary" id="downloads-play-all"><i class="fas fa-play"></i> Play Downloads</button>
            </div>
            ${state.downloads.map((s, idx) => renderSongRowHtml(s, idx)).join('')}
        `;
        list._songs = state.downloads;

        document.getElementById('downloads-play-all')?.addEventListener('click', () => {
            setQueue(state.downloads, 0);
        });
    }

    async function downloadSong(song) {
        if (!song) return;
        const streamUrl = getAudioStreamUrl(song, state.settings.downloadQuality);
        if (!streamUrl) {
            showToast('Download link not available for this song', 'error');
            return;
        }

        showToast(`Starting download: "${getSongTitle(song)}"`, 'info');

        try {
            const resp = await fetch(streamUrl);
            const blob = await resp.blob();
            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            const safeName = `${getArtistName(song)} - ${getSongTitle(song)}.m4a`.replace(/[/\\?%*:|"<>]/g, '-');
            a.download = safeName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

            // Add to downloads history
            if (!state.downloads.some(s => s.id === song.id)) {
                state.downloads.unshift(song);
                saveStorage('bitgroove_downloads', state.downloads);
            }

            showToast(`Downloaded: "${getSongTitle(song)}"`, 'success');
        } catch (e) {
            // Direct link fallback
            window.open(streamUrl, '_blank');
            showToast('Download started in new tab', 'info');
        }
    }

    // ==========================================
    // 17. TRENDING & CHARTS PAGES
    // ==========================================
    async function renderTrendingPage() {
        const list = document.getElementById('trending-list');
        if (!list) return;
        renderDiscoveryState(list, 'Loading trending music?');
        const modules = state.homeModules?.trending?.songs?.length ? state.homeModules : await API.getModules(state.settings.languages.join(','));
        const songs = modules?.trending?.songs || [];
        setDiscoveryItems(list, songs, (song, index) => renderSongRowHtml(song, index), 'songs', 'Trending music is temporarily unavailable.');
    }

    async function renderChartsPage() {
        const grid = document.getElementById('charts-grid');
        if (!grid) return;
        renderDiscoveryState(grid, 'Loading charts?');
        const modules = state.homeModules?.charts?.length ? state.homeModules : await API.getModules(state.settings.languages.join(','));
        setDiscoveryItems(grid, modules?.charts || [], renderPlaylistCardHtml, 'playlists', 'Charts are temporarily unavailable.');
    }

    // ==========================================
    // 18. LYRICS VIEWER & SYNC
    // ==========================================
    async function showLyrics(song) {
        if (!song) return;
        const panel = document.getElementById('lyrics-panel');
        const content = document.getElementById('lyrics-content');
        const fsPanel = document.getElementById('fs-lyrics-panel');
        const fsContent = document.getElementById('fs-lyrics-content');

        if (panel) panel.classList.add('active');
        if (content) content.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Fetching lyrics...</p></div>';

        try {
            let lyricsText = null;

            // 1. Try JioSaavn lyrics (works for jiosaavn songs)
            if (!song.id?.startsWith('deezer-') && !song.id?.startsWith('yt-') && !song.id?.startsWith('itunes-') && !song.id?.startsWith('audius-')) {
                lyricsText = await API.getSongLyrics(song.id);
            }

            // 2. Try external lyrics.ovh for all other sources
            if (!lyricsText) {
                try {
                    const artist = encodeURIComponent(getArtistName(song));
                    const title = encodeURIComponent(getSongTitle(song));
                    const lyricsRes = await fetch(`/api/lyrics/external?artist=${artist}&title=${title}`);
                    if (lyricsRes.ok) {
                        const lyricsJson = await lyricsRes.json();
                        if (lyricsJson.success && lyricsJson.data?.lyrics) {
                            lyricsText = lyricsJson.data.lyrics;
                        }
                    }
                } catch (e) {}
            }

            const textToDisplay = lyricsText || '♪ Instrumental or lyrics not available for this track ♪';
            const html = `<div style="padding: 10px 0; font-size: 16px; line-height: 2.2;">${textToDisplay.replace(/\n/g, '<br>')}</div>`;

            if (content) content.innerHTML = html;
            if (fsContent) fsContent.innerHTML = html;
        } catch (e) {
            const fallback = '♪ Instrumental / Lyrics unavailable ♪';
            if (content) content.innerHTML = `<div class="empty-state"><p>${fallback}</p></div>`;
            if (fsContent) fsContent.innerHTML = `<div class="empty-state"><p>${fallback}</p></div>`;
        }
    }

    // ==========================================
    // 19. SLEEP TIMER CONTROLLER
    // ==========================================
    function setSleepTimer(minutes) {
        if (state.sleepTimer.intervalId) {
            clearInterval(state.sleepTimer.intervalId);
            state.sleepTimer.intervalId = null;
        }

        const badge = document.getElementById('sleep-timer-remaining');
        if (minutes <= 0) {
            state.sleepTimer.durationMinutes = 0;
            state.sleepTimer.remainingSeconds = 0;
            if (badge) badge.style.display = 'none';
            showToast('Sleep timer turned off', 'info');
            return;
        }

        state.sleepTimer.durationMinutes = minutes;
        state.sleepTimer.remainingSeconds = minutes * 60;
        if (badge) {
            badge.style.display = 'inline-block';
            badge.textContent = `${minutes}m remaining`;
        }
        showToast(`Sleep timer set for ${minutes} minutes`, 'success');

        state.sleepTimer.intervalId = setInterval(() => {
            state.sleepTimer.remainingSeconds--;
            if (state.sleepTimer.remainingSeconds <= 0) {
                clearInterval(state.sleepTimer.intervalId);
                state.sleepTimer.intervalId = null;
                if (state.isPlaying) togglePlay();
                if (badge) badge.style.display = 'none';
                showToast('Sleep timer reached. Goodnight! 🌙', 'info');
            } else {
                const remMins = Math.ceil(state.sleepTimer.remainingSeconds / 60);
                if (badge) badge.textContent = `${remMins}m remaining`;
            }
        }, 1000);
    }

    // ==========================================
    // 20. CONTEXT MENU & MODALS
    // ==========================================
    function showContextMenu(e, song) {
        e.preventDefault();
        state.selectedSongForContext = song;
        const menu = document.getElementById('context-menu');
        if (!menu) return;

        menu.style.display = 'block';
        const x = Math.min(e.clientX, window.innerWidth - 240);
        const y = Math.min(e.clientY, window.innerHeight - 320);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    }

    function hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }

    function openAddToPlaylistModal(song) {
        const modal = document.getElementById('add-to-playlist-modal');
        const list = document.getElementById('modal-playlist-list');
        if (!modal || !list) return;

        list.innerHTML = state.playlists.map(pl => `
            <div class="modal-playlist-item" data-pl-id="${pl.id}">
                <i class="fas fa-list-ul"></i>
                <span>${decodeHtmlEntities(pl.name)}</span>
            </div>
        `).join('');

        list.querySelectorAll('.modal-playlist-item').forEach(item => {
            item.addEventListener('click', () => {
                addSongToUserPlaylist(item.dataset.plId, song);
                modal.style.display = 'none';
            });
        });

        modal.style.display = 'flex';
    }

    // ==========================================
    // 21. THEME & APPEARANCE
    // ==========================================
    function applyTheme(themeName) {
        state.settings.theme = themeName;
        document.documentElement.setAttribute('data-theme', themeName);
        const icon = document.querySelector('#theme-toggle i');
        if (icon) {
            icon.className = themeName === 'light' ? 'fas fa-sun' : 'fas fa-moon';
        }
        saveStorage('bitgroove_settings', state.settings);
    }

    function applyAccentColor(hexColor) {
        state.settings.accentColor = hexColor;
        document.documentElement.style.setProperty('--primary', hexColor);
        document.documentElement.style.setProperty('--primary-glow', hexColor + '4d');

        document.querySelectorAll('.accent-color').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === hexColor);
        });
        saveStorage('bitgroove_settings', state.settings);
    }

    // ==========================================
    // 22. EVENT LISTENERS SETUP
    // ==========================================
    function setupEventListeners() {
        document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
            const open = document.getElementById('sidebar')?.classList.contains('mobile-open');
            setMobileNavigation(!open);
        });
        document.getElementById('mobile-nav-backdrop')?.addEventListener('click', () => setMobileNavigation(false));
        document.querySelectorAll('[data-discover]').forEach(button => {
            button.addEventListener('click', () => showDiscoveryCollection(button.dataset.discover));
        });
        document.addEventListener('click', event => {
            if (event.target.closest('[data-retry-discovery]')) retryDiscovery();
        });
        window.addEventListener('resize', () => {
            if (window.innerWidth > 900) setMobileNavigation(false);
        });
        document.getElementById('autoplay-toggle')?.addEventListener('change', event => setAutoplay(event.target.checked));
        // --- Sidebar Navigation ---
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                if (page) navigateTo(page);
            });
        });

        // Sidebar Footer Nav
        document.querySelectorAll('.sidebar-footer .nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                if (page) navigateTo(page);
            });
        });

        // Sidebar Collapse Toggle
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('sidebar');
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                if (window.innerWidth <= 900) { setMobileNavigation(false); return; }
                const collapsed = sidebar.classList.toggle('collapsed');
                document.getElementById('app')?.classList.toggle('sidebar-is-collapsed', collapsed);
            });
        }

        // --- Top Bar History Navigation ---
        document.getElementById('back-btn')?.addEventListener('click', goBack);
        document.getElementById('forward-btn')?.addEventListener('click', goForward);

        // --- Theme Toggle ---
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            const current = state.settings.theme;
            applyTheme(current === 'light' ? 'dark' : 'light');
        });

        // --- Search Input & Clear ---
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value;
                if (searchClear) searchClear.style.display = val ? 'flex' : 'none';
                if (state.currentPage !== 'search') navigateTo('search');
                performSearch(val);
            });

            searchInput.addEventListener('focus', () => {
                if (state.currentPage !== 'search') navigateTo('search');
            });
        }

        if (searchClear && searchInput) {
            searchClear.addEventListener('click', () => {
                searchInput.value = '';
                searchClear.style.display = 'none';
                performSearch('');
            });
        }

        // --- Search Filter Buttons ---
        document.querySelectorAll('.search-filters .filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.search-filters .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.searchFilter = btn.dataset.filter;
                if (searchInput) performSearch(searchInput.value);
            });
        });

        // --- Now Playing Bar Playback Controls ---
        document.getElementById('play-btn')?.addEventListener('click', togglePlay);
        document.getElementById('next-btn')?.addEventListener('click', () => playNext(true));
        document.getElementById('prev-btn')?.addEventListener('click', playPrevious);
        document.getElementById('shuffle-btn')?.addEventListener('click', toggleShuffle);
        document.getElementById('repeat-btn')?.addEventListener('click', toggleRepeat);

        document.getElementById('np-like-btn')?.addEventListener('click', () => {
            if (state.currentSong) toggleFavorite(state.currentSong);
        });

        // Now Playing Artwork Click -> Open Fullscreen
        document.querySelector('.np-artwork-container')?.addEventListener('click', () => {
            const fs = document.getElementById('fullscreen-player');
            if (fs) fs.classList.add('active');
        });

        // --- Progress Bar Seeking ---
        const progressContainer = document.getElementById('progress-bar-container');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                const rect = progressContainer.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                seekTo(pos * 100);
            });
        }

        // --- Volume Slider ---
        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                setVolume(parseFloat(e.target.value));
            });
        }
        document.getElementById('volume-btn')?.addEventListener('click', toggleMute);

        // --- Panels: Queue & Lyrics ---
        const queueBtn = document.getElementById('queue-btn');
        const queuePanel = document.getElementById('queue-panel');
        const closeQueueBtn = document.getElementById('close-queue-btn');
        const clearQueueBtn = document.getElementById('clear-queue-btn');

        if (queueBtn && queuePanel) {
            queueBtn.addEventListener('click', () => {
                queuePanel.classList.toggle('active');
                if (queuePanel.classList.contains('active')) renderQueue();
            });
        }
        if (closeQueueBtn && queuePanel) {
            closeQueueBtn.addEventListener('click', () => queuePanel.classList.remove('active'));
        }
        if (clearQueueBtn) {
            clearQueueBtn.addEventListener('click', clearQueue);
        }

        const lyricsBtn = document.getElementById('lyrics-btn');
        const lyricsPanel = document.getElementById('lyrics-panel');
        const closeLyricsBtn = document.getElementById('close-lyrics-btn');

        if (lyricsBtn && lyricsPanel) {
            lyricsBtn.addEventListener('click', () => {
                lyricsPanel.classList.toggle('active');
                if (lyricsPanel.classList.contains('active') && state.currentSong) {
                    showLyrics(state.currentSong);
                }
            });
        }
        if (closeLyricsBtn && lyricsPanel) {
            closeLyricsBtn.addEventListener('click', () => lyricsPanel.classList.remove('active'));
        }

        // --- Fullscreen Player Controls ---
        const fsPlayer = document.getElementById('fullscreen-player');
        document.getElementById('fullscreen-btn')?.addEventListener('click', () => {
            if (fsPlayer) fsPlayer.classList.add('active');
        });
        document.getElementById('yt-video-btn')?.addEventListener('click', toggleYouTubeVideo);
        document.getElementById('fs-close')?.addEventListener('click', () => {
            if (fsPlayer) fsPlayer.classList.remove('active');
        });

        document.getElementById('fs-play')?.addEventListener('click', togglePlay);
        document.getElementById('fs-next')?.addEventListener('click', () => playNext(true));
        document.getElementById('fs-prev')?.addEventListener('click', playPrevious);
        document.getElementById('fs-shuffle')?.addEventListener('click', toggleShuffle);
        document.getElementById('fs-repeat')?.addEventListener('click', toggleRepeat);

        document.getElementById('fs-like')?.addEventListener('click', () => {
            if (state.currentSong) toggleFavorite(state.currentSong);
        });

        document.getElementById('fs-download-btn')?.addEventListener('click', () => {
            if (state.currentSong) downloadSong(state.currentSong);
        });

        document.getElementById('fs-add-to-playlist')?.addEventListener('click', () => {
            if (state.currentSong) openAddToPlaylistModal(state.currentSong);
        });

        document.getElementById('fs-lyrics')?.addEventListener('click', () => {
            const fsLyrics = document.getElementById('fs-lyrics-panel');
            if (fsLyrics) {
                const isHidden = fsLyrics.style.display === 'none';
                fsLyrics.style.display = isHidden ? 'block' : 'none';
                if (isHidden && state.currentSong) showLyrics(state.currentSong);
            }
        });

        const fsProgressContainer = document.getElementById('fs-progress-container');
        if (fsProgressContainer) {
            fsProgressContainer.addEventListener('click', (e) => {
                const rect = fsProgressContainer.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                seekTo(pos * 100);
            });
        }

        // --- Equalizer Presets & Sliders ---
        document.querySelectorAll('.eq-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                initWebAudio();
                applyEqPreset(btn.dataset.preset);
            });
        });

        document.getElementById('bass-boost-slider')?.addEventListener('input', (e) => {
            initWebAudio();
            const val = parseFloat(e.target.value);
            state.bassBoostValue = val;
            if (bassBoostNode && audioContext) {
                bassBoostNode.gain.setTargetAtTime((val / 100) * 12, audioContext.currentTime, 0.05);
            }
        });

        // --- Settings Inputs ---
        document.getElementById('streaming-quality')?.addEventListener('change', (e) => {
            state.settings.streamingQuality = e.target.value;
            saveStorage('bitgroove_settings', state.settings);
            showToast(`Streaming quality set to ${e.target.value}`, 'success');
        });

        document.getElementById('download-quality')?.addEventListener('change', (e) => {
            state.settings.downloadQuality = e.target.value;
            saveStorage('bitgroove_settings', state.settings);
        });

        document.getElementById('theme-select')?.addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });

        document.querySelectorAll('.accent-color').forEach(btn => {
            btn.addEventListener('click', () => {
                applyAccentColor(btn.dataset.color);
            });
        });

        document.getElementById('dynamic-bg-toggle')?.addEventListener('change', (e) => {
            state.settings.dynamicBg = e.target.checked;
            const bg = document.getElementById('dynamic-bg');
            if (bg) bg.style.display = e.target.checked ? 'block' : 'none';
            saveStorage('bitgroove_settings', state.settings);
        });

        document.getElementById('sleep-timer-select')?.addEventListener('change', (e) => {
            setSleepTimer(parseInt(e.target.value, 10));
        });

        document.getElementById('clear-data-btn')?.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all listening history, favorites, and playlists?')) {
                localStorage.clear();
                location.reload();
            }
        });

        // --- Playlist Modals ---
        const playlistModal = document.getElementById('playlist-modal');
        document.getElementById('create-playlist-btn')?.addEventListener('click', () => {
            if (playlistModal) playlistModal.style.display = 'flex';
        });
        document.getElementById('playlist-cancel')?.addEventListener('click', () => {
            if (playlistModal) playlistModal.style.display = 'none';
        });
        document.getElementById('playlist-create')?.addEventListener('click', () => {
            const nameInput = document.getElementById('playlist-name-input');
            const descInput = document.getElementById('playlist-desc-input');
            if (nameInput && nameInput.value.trim()) {
                createPlaylist(nameInput.value, descInput ? descInput.value : '');
                nameInput.value = '';
                if (descInput) descInput.value = '';
                if (playlistModal) playlistModal.style.display = 'none';
            }
        });

        const addPlModal = document.getElementById('add-to-playlist-modal');
        document.getElementById('add-playlist-cancel')?.addEventListener('click', () => {
            if (addPlModal) addPlModal.style.display = 'none';
        });
        document.getElementById('add-playlist-new')?.addEventListener('click', () => {
            if (addPlModal) addPlModal.style.display = 'none';
            if (playlistModal) playlistModal.style.display = 'flex';
        });

        // --- Context Menu Actions ---
        document.querySelectorAll('#context-menu .context-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                const song = state.selectedSongForContext;
                hideContextMenu();
                if (!song) return;

                switch (action) {
                    case 'play':
                        playSong(song);
                        break;
                    case 'play-next':
                        addNextToQueue(song);
                        break;
                    case 'add-queue':
                        addToQueue(song);
                        break;
                    case 'like':
                        toggleFavorite(song);
                        break;
                    case 'add-playlist':
                        openAddToPlaylistModal(song);
                        break;
                    case 'download':
                        downloadSong(song);
                        break;
                    case 'artist':
                        if (song.primaryArtistsId || song.artistId) {
                            navigateTo('artist-detail', song.primaryArtistsId || song.artistId);
                        } else {
                            // Search artist
                            const searchIn = document.getElementById('search-input');
                            if (searchIn) searchIn.value = getArtistName(song);
                            navigateTo('search');
                            performSearch(getArtistName(song));
                        }
                        break;
                    case 'album':
                        if (song.album?.id) {
                            navigateTo('album-detail', song.album.id);
                        }
                        break;
                    case 'share':
                        if (navigator.share) {
                            navigator.share({
                                title: getSongTitle(song),
                                text: `Listen to ${getSongTitle(song)} on BitGroove`,
                                url: window.location.href
                            }).catch(() => { });
                        } else {
                            navigator.clipboard.writeText(window.location.href);
                            showToast('Link copied to clipboard!', 'success');
                        }
                        break;
                }
            });
        });

        // Close context menu on any document click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#context-menu')) {
                hideContextMenu();
            }
        });

        // --- GLOBAL EVENT DELEGATION (Cards, Rows, Quick Picks) ---
        document.addEventListener('click', (e) => {
            // 1. Song Row Click
            const row = e.target.closest('.song-row');
            if (row) {
                const songId = row.dataset.songId;
                const container = row.closest('.song-list');
                const songs = container?._songs || container?.parentElement?._songs || state.lastSearchResults || [];
                const song = songs.find(s => String(s.id) === String(songId)) || CURATED_FALLBACK_SONGS.find(s => String(s.id) === String(songId));

                // Check action buttons
                if (e.target.closest('.like-btn')) {
                    if (song) toggleFavorite(song);
                    return;
                }
                if (e.target.closest('.more-btn')) {
                    if (song) showContextMenu(e, song);
                    return;
                }

                // Play song and queue rest
                if (song) {
                    const idx = songs.findIndex(s => s.id === songId);
                    setQueue(songs.length > 0 ? songs : [song], Math.max(0, idx));
                }
                return;
            }

            // 2. Song Card Click
            const songCard = e.target.closest('.song-card');
            if (songCard) {
                const songId = songCard.dataset.songId;
                const container = songCard.closest('.horizontal-scroll');
                const pool = container?._songs || state.homeTrendingSongs || state.lastSearchResults || CURATED_FALLBACK_SONGS;
                const song = pool.find(s => String(s.id) === String(songId)) || CURATED_FALLBACK_SONGS.find(s => String(s.id) === String(songId));
                if (song) playSong(song);
                return;
            }

            // 3. Quick Pick Card Click
            const qpCard = e.target.closest('.quick-pick-card');
            if (qpCard) {
                const songId = qpCard.dataset.songId;
                const container = qpCard.closest('.quick-picks-grid');
                const pool = container?._songs || state.homeTrendingSongs || state.lastSearchResults || CURATED_FALLBACK_SONGS;
                const song = pool.find(s => String(s.id) === String(songId)) || CURATED_FALLBACK_SONGS.find(s => String(s.id) === String(songId));
                if (song) playSong(song);
                return;
            }

            // 4. Album Card Click
            const albumCard = e.target.closest('.album-card');
            if (albumCard) {
                const albumId = albumCard.dataset.albumId;
                const container = albumCard.closest('.horizontal-scroll, #discover-grid, #search-results');
                const album = container?._albums?.find(item => String(item.id) === albumId);
                if (albumId) navigateTo('album-detail', album || albumId);
                return;
            }

            // 5. Artist Card Click
            const artistCard = e.target.closest('.artist-card');
            if (artistCard) {
                const artistId = artistCard.dataset.artistId;
                const container = artistCard.closest('.horizontal-scroll, #discover-grid, #search-results');
                const artist = container?._artists?.find(item => String(item.id) === artistId);
                if (artist?.searchQuery || artist?.name) {
                    state.searchFilter = 'songs';
                    document.querySelectorAll('.search-filters .filter-btn').forEach(button => button.classList.toggle('active', button.dataset.filter === 'songs'));
                    const input = document.getElementById('search-input');
                    const query = artist.searchQuery || artist.name;
                    if (input) input.value = query;
                    navigateTo('search');
                    performSearch(query);
                } else if (artistId) navigateTo('artist-detail', artistId);
                return;
            }

            // 6. Playlist Card Click
            const playlistCard = e.target.closest('.playlist-card');
            if (playlistCard && !playlistCard.dataset.localPlaylistId) {
                const playlistId = playlistCard.dataset.playlistId;
                const container = playlistCard.closest('.horizontal-scroll, #charts-grid, #discover-grid, #search-results');
                const playlist = container?._playlists?.find(item => String(item.id) === playlistId);
                if (playlistId) navigateTo('playlist-detail', playlist || playlistId);
                return;
            }
        });

        // Right click delegation for Song Rows & Cards
        document.addEventListener('contextmenu', (e) => {
            const row = e.target.closest('.song-row');
            if (row) {
                const container = row.closest('.song-list');
                const songs = container?._songs || container?.parentElement?._songs || state.lastSearchResults || [];
                const song = songs.find(s => String(s.id) === String(row.dataset.songId)) || CURATED_FALLBACK_SONGS.find(s => String(s.id) === String(row.dataset.songId));
                if (song) showContextMenu(e, song);
                return;
            }
            const card = e.target.closest('.song-card, .quick-pick-card');
            if (card) {
                const container = card.closest('.horizontal-scroll, .quick-picks-grid');
                const pool = container?._songs || state.homeTrendingSongs || [];
                const song = pool.find(s => String(s.id) === card.dataset.songId);
                if (song) showContextMenu(e, song);
                return;
            }
        });

        // --- KEYBOARD SHORTCUTS ---
        document.addEventListener('keydown', (e) => {
            const card = e.target.closest?.('.song-card, .quick-pick-card, .album-card, .playlist-card, .artist-card');
            if (card && (e.code === 'Enter' || e.code === 'Space')) {
                e.preventDefault();
                card.click();
                return;
            }
            // Ignore if inside text inputs
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
                return;
            }

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (state.isYtPlaying && ytPlayer) {
                        try { ytPlayer.seekTo((ytPlayer.getCurrentTime() || 0) + 5, true); } catch(err) {}
                    } else if (audio.duration) {
                        audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (state.isYtPlaying && ytPlayer) {
                        try { ytPlayer.seekTo(Math.max(0, (ytPlayer.getCurrentTime() || 0) - 5), true); } catch(err) {}
                    } else {
                        audio.currentTime = Math.max(0, audio.currentTime - 5);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setVolume(state.volume + 5);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setVolume(state.volume - 5);
                    break;
                case 'KeyN':
                    playNext();
                    break;
                case 'KeyP':
                    playPrevious();
                    break;
                case 'KeyM':
                    toggleMute();
                    break;
                case 'KeyL':
                    if (state.currentSong) toggleFavorite(state.currentSong);
                    break;
                case 'KeyS':
                    toggleShuffle();
                    break;
                case 'KeyR':
                    toggleRepeat();
                    break;
                case 'KeyF':
                    fsPlayer?.classList.toggle('active');
                    break;
                case 'Escape':
                    setMobileNavigation(false);
                    fsPlayer?.classList.remove('active');
                    queuePanel?.classList.remove('active');
                    lyricsPanel?.classList.remove('active');
                    if (playlistModal) playlistModal.style.display = 'none';
                    if (addPlModal) addPlModal.style.display = 'none';
                    hideContextMenu();
                    break;
            }
        });
    }

    // ==========================================
    // 23. AUDIO ELEMENT EVENT LISTENERS
    // ==========================================
    function setupAudioListeners() {
        const currentTimeEl = document.getElementById('np-current-time');
        const durationEl = document.getElementById('np-duration');
        const progressFill = document.getElementById('progress-bar-fill');

        const fsCurrentTimeEl = document.getElementById('fs-current-time');
        const fsDurationEl = document.getElementById('fs-duration');
        const fsProgressFill = document.getElementById('fs-progress-fill');

        audio.addEventListener('timeupdate', () => {
            if (state.isYtPlaying) return;
            if (audio.currentTime > state.currentTime) clearYouTubeAudioWatchdog();
            if (!audio.duration || isNaN(audio.duration)) return;
            state.currentTime = audio.currentTime;
            state.duration = audio.duration;

            const percent = (audio.currentTime / audio.duration) * 100;
            const timeStr = formatTime(audio.currentTime);

            if (currentTimeEl) currentTimeEl.textContent = timeStr;
            if (fsCurrentTimeEl) fsCurrentTimeEl.textContent = timeStr;
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (fsProgressFill) fsProgressFill.style.width = `${percent}%`;
        });

        audio.addEventListener('loadedmetadata', () => {
            if (state.isYtPlaying) return;
            state.duration = audio.duration;
            const durStr = formatTime(audio.duration);
            if (durationEl) durationEl.textContent = durStr;
            if (fsDurationEl) fsDurationEl.textContent = durStr;
        });

        audio.addEventListener('ended', () => {
            if (state.isYtPlaying || !audio.ended) return;
            state.isPlaying = false;
            updatePlayButtons(false);
            playNext(false);
        });

        audio.addEventListener('play', () => {
            if (state.isYtPlaying || audio.paused) return;
            state.isPlaying = true;
            updatePlayButtons(true);
        });

        audio.addEventListener('playing', clearYouTubeAudioWatchdog);
        audio.addEventListener('waiting', () => watchYouTubeAudio());
        audio.addEventListener('stalled', () => watchYouTubeAudio());

        audio.addEventListener('pause', () => {
            if (state.isYtPlaying || !audio.paused) return;
            if (!audio.error) {
                playbackWantsToPlay = false;
                clearYouTubeAudioWatchdog();
            }
            state.isPlaying = false;
            updatePlayButtons(false);
        });

        audio.addEventListener('error', (e) => {
            // A source change can leave a queued error event from the old download.
            if (state.isYtPlaying || !audio.error) return;
            if (fallbackToYouTube()) return;
            clearYouTubeAudioWatchdog();
            ++continuationRequest;
            console.warn('Audio load error', e);
            state.isPlaying = false;
            updatePlayButtons(false);
            showToast('This stream could not load. Press play to retry or choose another track.', 'error');
        });
    }

    // ==========================================
    // 24. APP BOOTSTRAP INITIALIZATION
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {
        // Load persisted storage
        loadInitialStorage();

        // Apply visual preferences
        applyTheme(state.settings.theme);
        applyAccentColor(state.settings.accentColor);

        // Update greeting
        const greetingHeader = document.querySelector('#page-home .page-header h1');
        if (greetingHeader) greetingHeader.textContent = getGreeting();

        // Build equalizer sliders
        renderEqualizerSliders();
        applyEqPreset(state.eqPreset);

        // Setup all events
        setupEventListeners();
        setupAudioListeners();

        // Set initial volume
        setVolume(state.volume);

        // Render user playlists in sidebar
        renderSidebarPlaylists();

        // Populate homepage content
        loadHomePage();

        console.log('🎵 BitGroove Music Player successfully initialized!');
    });

})();
