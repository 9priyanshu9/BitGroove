"""Network-independent regressions for search, media metadata and the audio proxy."""
import base64
import io
import json
import pathlib
import shutil
import socketserver
import subprocess
import sys
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server


def encrypted_url(url):
    raw = url.encode()
    padding = 8 - len(raw) % 8
    raw += bytes([padding]) * padding
    keys = server._expand_key(b"38346591")
    encrypted = b"".join(server._des_block(raw[i:i + 8], keys, decrypt=False)
                         for i in range(0, len(raw), 8))
    return base64.b64encode(encrypted).decode()


def jio_track(track_id="song-1"):
    return {
        "id": track_id, "title": "Rock &amp; Roll", "image": "https://c.saavncdn.com/art-150x150.jpg",
        "more_info": {
            "encrypted_media_url": encrypted_url("https://aac.saavncdn.com/123/song_96.mp4"),
            "duration": "210", "album": "A &amp; B", "album_id": "123", "320kbps": "true",
            "artistMap": {"primary_artists": [{"name": "Artist"}]}
        }
    }


ITUNES = {
    "trackId": 42, "trackName": "Song", "artistName": "Artist", "collectionId": 3,
    "trackTimeMillis": 200000,
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/test.m4a"
}


class MetadataTests(unittest.TestCase):
    def test_des_matches_standard_known_answer(self):
        keys = server._expand_key(bytes.fromhex("133457799BBCDFF1"))
        result = server._des_block(bytes.fromhex("85E813540F0AB405"), keys)
        self.assertEqual(result.hex().upper(), "0123456789ABCDEF")

    def test_jio_current_nested_response_decodes(self):
        song = server.format_jiosaavn_song(jio_track())
        self.assertEqual(song["name"], "Rock & Roll")
        self.assertEqual(song["primaryArtists"], "Artist")
        self.assertEqual(song["duration"], 210)
        self.assertEqual(song["source"], "jiosaavn")
        self.assertFalse(song["isPreview"])
        self.assertEqual(song["downloadUrl"][-1]["link"], "https://aac.saavncdn.com/123/song_320.mp4")

    def test_unsupported_320_quality_is_not_advertised(self):
        record = jio_track()
        record["more_info"]["320kbps"] = "false"
        self.assertNotIn("320kbps", [item["quality"] for item in server.format_jiosaavn_song(record)["downloadUrl"]])

    def test_malformed_ciphertext_cannot_become_stream_url(self):
        for cipher in ("bogus", "aGVsbG8=", encrypted_url("https://localhost/private")):
            self.assertEqual(server.decrypt_jiosaavn_url(cipher), "")

    def test_preview_durations_and_sources_are_truthful(self):
        itunes = server.format_itunes_track(ITUNES)
        deezer = server.format_deezer_track({"id": 1, "duration": 250,
                                            "preview": "https://cdns-preview-1.dzcdn.net/stream/test.mp3"})
        for song, source, original in ((itunes, "itunes", 200), (deezer, "deezer", 250)):
            self.assertEqual(song["duration"], 30)
            self.assertEqual(song["originalDuration"], original)
            self.assertEqual(song["source"], source)
            self.assertTrue(song["isPreview"])
        self.assertEqual(itunes["downloadUrl"][0]["quality"], "preview")


class SearchTests(unittest.TestCase):
    def setUp(self):
        server.SEARCH_CACHE.clear()

    def test_jio_success_returns_before_youtube_or_fallback(self):
        with patch.object(server, "jiosaavn_call", return_value={"results": [None, jio_track(), jio_track("song-2")]}) as jio, \
                patch.object(server, "fetch_json") as external, \
                patch.object(server, "youtube_innertube_search") as youtube:
            results = server.search_songs(" Artist ", page=2, limit=1)
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["source"], "jiosaavn")
            self.assertEqual(jio.call_args.args[1]["p"], "3")
            external.assert_not_called()
            youtube.assert_not_called()

    def test_failed_primary_does_not_block_preview_fallback(self):
        with patch.object(server, "jiosaavn_call", side_effect=TimeoutError()), \
                patch.object(server, "fetch_json", return_value={"results": [ITUNES]}) as fallback:
            results = server.search_songs("Artist")
            self.assertEqual(results[0]["source"], "itunes")
            self.assertEqual(fallback.call_count, 1)

    def test_broken_itunes_falls_through_to_deezer(self):
        deezer = {"id": 3, "preview": "https://cdns-preview-1.dzcdn.net/stream/test.mp3"}
        with patch.object(server, "jiosaavn_call", return_value=None), \
                patch.object(server, "fetch_json", side_effect=[None, {"data": [deezer]}]) as fallback:
            results = server.search_songs("Artist")
            self.assertEqual(results[0]["source"], "deezer")
            self.assertEqual(fallback.call_count, 2)

    def test_successful_search_is_cached_without_caching_failures(self):
        with patch.object(server, "jiosaavn_call", return_value={"results": [jio_track()]}) as jio:
            server.search_songs("Artist")
            server.search_songs("artist")
            self.assertEqual(jio.call_count, 1)
        server.SEARCH_CACHE.clear()
        with patch.object(server, "jiosaavn_call", return_value=None) as jio, \
                patch.object(server, "fetch_json", return_value=None):
            self.assertEqual(server.search_songs("Nobody"), [])
            self.assertEqual(server.search_songs("Nobody"), [])
            self.assertEqual(jio.call_count, 2)


class MediaSafetyTests(unittest.TestCase):
    def test_only_provider_https_hosts_are_accepted(self):
        for url in ("https://aac.saavncdn.com/audio.mp4", ITUNES["previewUrl"],
                    "https://discoveryprovider.audius.co/v1/tracks/a/stream",
                    "https://rr.googlevideo.com/videoplayback?id=1"):
            self.assertTrue(server.is_allowed_media_url(url), url)
        for url in ("http://aac.saavncdn.com/audio.mp4", "https://127.0.0.1/a", "https://localhost/a",
                    "https://aac.saavncdn.com.evil.test/a", "https://evilsaavncdn.com/a",
                    "https://googlevideo.com.evil.test/a",
                    "https://user:pass@aac.saavncdn.com/a", "https://aac.saavncdn.com:3000/a",
                    "https://aac.saavncdn.com/a#fragment", "https://aac.saavncdn.com/\na", None):
            self.assertFalse(server.is_allowed_media_url(url), url)

    def test_youtube_audio_streams_only_accept_googlevideo_https_urls(self):
        self.assertTrue(server.is_allowed_youtube_audio_url("https://rr.googlevideo.com/videoplayback?id=1"))
        for url in ("http://rr.googlevideo.com/audio", "https://googlevideo.com.evil.test/audio",
                    "https://localhost/audio", "https://rr.googlevideo.com:444/audio"):
            self.assertFalse(server.is_allowed_youtube_audio_url(url), url)

    def test_youtube_audio_resolution_chooses_highest_safe_audio_bitrate(self):
        payload = {
            "playabilityStatus": {"status": "OK"},
            "streamingData": {"adaptiveFormats": [
                {"url": "https://rr.googlevideo.com/low", "mimeType": "audio/webm", "averageBitrate": 128000},
                {"url": "https://evil.example/audio", "mimeType": "audio/webm", "averageBitrate": 999000},
                {"url": "https://rr.googlevideo.com/video", "mimeType": "video/mp4", "averageBitrate": 999000},
                {"url": "https://rr.googlevideo.com/high", "mimeType": "audio/webm", "averageBitrate": 256000}
            ]}
        }
        with patch.object(server, "fetch_json_post", return_value=payload) as player:
            stream = server.resolve_youtube_audio_stream("abcdefghijk")
        self.assertEqual(stream, {
            "url": "https://rr.googlevideo.com/high",
            "bitrate": 256000,
            "mimeType": "audio/webm"
        })
        self.assertEqual(player.call_args.args[1]["context"]["client"]["clientName"], "ANDROID")

    def test_piped_is_used_when_youtube_player_clients_have_no_stream(self):
        payload = {"audioStreams": [
            {"url": "https://rr.googlevideo.com/audio", "bitrate": 128000, "mimeType": "audio/webm"}
        ]}
        with patch.object(server, "fetch_json_post", return_value=None), \
                patch.object(server, "fetch_json", return_value=payload) as piped:
            stream = server.resolve_youtube_audio_stream("abcdefghijk")
        self.assertEqual(stream["url"], "https://rr.googlevideo.com/audio")
        self.assertEqual(piped.call_count, 1)

    def test_youtube_prefers_browser_compatible_aac_over_higher_bitrate_formats(self):
        payload = {
            "playabilityStatus": {"status": "OK"},
            "streamingData": {"adaptiveFormats": [
                {"url": "https://rr.googlevideo.com/opus", "mimeType": 'audio/webm; codecs="opus"', "bitrate": 256000},
                {"url": "https://rr.googlevideo.com/dolby", "mimeType": 'audio/mp4; codecs="ec-3"', "bitrate": 384000},
                {"url": "https://rr.googlevideo.com/aac", "mimeType": 'audio/mp4; codecs="mp4a.40.2"', "bitrate": 128000}
            ]}
        }
        with patch.object(server, "fetch_json_post", return_value=payload):
            self.assertEqual(server.resolve_youtube_audio_stream("VYOjWnS4cMY")["url"], "https://rr.googlevideo.com/aac")

    def test_youtube_ranges_are_bounded_for_loading_and_seeking(self):
        url = "https://rr.googlevideo.com/videoplayback?clen=4000000"
        cases = {
            None: "bytes=0-262143",
            "bytes=0-": "bytes=0-262143",
            "bytes=300000-": "bytes=300000-562143",
            "bytes=300000-350000": "bytes=300000-350000",
            "bytes=0-3999999": "bytes=0-262143",
            "bytes=3999000-": "bytes=3999000-3999999",
            "bytes=-1000": "bytes=3999000-3999999"
        }
        for original, expected in cases.items():
            self.assertEqual(server.youtube_media_range(url, original), expected)
        self.assertEqual(server.youtube_media_range(ITUNES["previewUrl"], None), None)
        self.assertEqual(server.youtube_media_range(ITUNES["previewUrl"], "bytes=0-"), "bytes=0-")

    @unittest.skipUnless(shutil.which("node"), "Node.js is unavailable")
    def test_node_youtube_codec_and_range_handling_matches_python(self):
        script = r'''
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('server.js', 'utf8');
const helpers = source.slice(source.indexOf('function isAllowedYouTubeAudioUrl('), source.indexOf('async function resolveInnerTubeAudioStream('));
const context = { URL }; vm.createContext(context); vm.runInContext(helpers, context);
const url = 'https://rr.googlevideo.com/videoplayback?clen=4000000';
for (const [input, output] of [[undefined, 'bytes=0-262143'], ['bytes=0-', 'bytes=0-262143'], ['bytes=300000-', 'bytes=300000-562143'], ['bytes=300000-350000', 'bytes=300000-350000'], ['bytes=3999000-', 'bytes=3999000-3999999'], ['bytes=-1000', 'bytes=3999000-3999999']]) {
    assert.equal(context.youtubeMediaRange(url, input), output);
}
assert.equal(context.youtubeMediaRange('https://aac.saavncdn.com/audio.mp4', 'bytes=0-'), 'bytes=0-');
const formats = [{ mimeType: 'audio/webm; codecs="opus"', bitrate: 256000 }, { mimeType: 'audio/mp4; codecs="ec-3"', bitrate: 384000 }, { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000 }];
assert.equal(formats.sort(context.compareYouTubeAudio)[0].bitrate, 128000);
'''
        result = subprocess.run([shutil.which("node"), "-e", script], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_redirect_to_unapproved_host_is_rejected(self):
        request = urllib.request.Request("https://aac.saavncdn.com/a")
        with self.assertRaises(urllib.error.HTTPError):
            try:
                server.SafeMediaRedirect().redirect_request(request, None, 302, "Moved", {}, "https://localhost/a")
            except urllib.error.HTTPError as error:
                error.close()
                raise


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        server.DISCOVERY_CACHE.clear()
        server.COLLECTION_CACHE.clear()

    def test_current_launch_modules_include_featured_playlists(self):
        payload = {"new_trending": [jio_track()], "new_albums": {"data": [{"id": "album-1", "title": "New Album", "type": "album", "image": [{"link": "https://c.saavncdn.com/art-150x150.jpg"}]}]},
                   "charts": [{"id": "chart-1", "title": "Hindi Top 50"}], "top_playlists": {"list": [{"id": "list-1", "title": "Morning Music"}]}}
        with patch.object(server, "jiosaavn_call", return_value=payload) as jio, patch.object(server, "fetch_json", return_value=None):
            data = server.get_modules("hindi,english")
        self.assertEqual(jio.call_args.args[0], "webapi.getLaunchData")
        self.assertTrue(all(data["availability"].values()))
        self.assertEqual(data["albums"][0]["type"], "album")
        self.assertEqual(data["albums"][0]["image"][0]["link"], "https://c.saavncdn.com/art-500x500.jpg")
        self.assertEqual(data["playlists"][0]["id"], "list-1")
        self.assertEqual(data["featuredPlaylists"], data["playlists"])

    def test_jio_outage_uses_real_deezer_charts_and_releases(self):
        track = {"id": 19, "title": "Chart Track", "preview": "https://cdns-preview-1.dzcdn.net/stream/test.mp3"}
        def external(url, **kwargs):
            if "/chart/0" in url:
                return {"tracks": {"data": [track]}, "playlists": {"data": [{"id": 7, "title": "Provider Playlist"}]}}
            if "/releases" in url:
                return {"data": [{"id": 4, "title": "Provider Release", "release_date": "2026-11-19"}]}
            return None
        with patch.object(server, "jiosaavn_call", return_value=None), patch.object(server, "fetch_json", side_effect=external):
            data = server.get_modules()
            card = server.get_collection_details("deezer-chart-global", "playlist")
        self.assertEqual(data["albums"][0]["id"], "deezer-album-4")
        self.assertEqual(data["playlists"][0]["id"], "deezer-playlist-7")
        self.assertEqual(data["charts"][0]["songs"][0]["id"], "deezer-19")
        self.assertEqual(card["songs"][0]["duration"], 30)
        self.assertTrue(card["songs"][0]["isPreview"])

    def test_album_details_accept_current_list_envelope(self):
        raw = {"id": "album-1", "title": "Album", "list": [jio_track()]}
        with patch.object(server, "jiosaavn_call", return_value=raw):
            data = server.get_collection_details("album-1", "album")
        self.assertEqual(len(data["songs"]), 1)
        self.assertEqual(data["songs"][0]["source"], "jiosaavn")

    def test_itunes_album_prefix_never_routes_to_jio(self):
        with patch.object(server, "jiosaavn_call") as jio, patch.object(server, "fetch_json", return_value={"results": [{"collectionName": "Album"}, ITUNES]}):
            data = server.get_collection_details("itunes-album-3", "album")
            jio.assert_not_called()
        self.assertEqual(data["songs"][0]["id"], "itunes-42")

    def test_provider_tracks_keep_source_aware_album_navigation(self):
        self.assertEqual(server.format_itunes_track(ITUNES)["album"]["id"], "itunes-album-3")
        track = {"id": 19, "title": "Track", "preview": "https://cdns-preview-1.dzcdn.net/stream/test.mp3", "album": {"id": 4}}
        self.assertEqual(server.format_deezer_track(track)["album"]["id"], "deezer-album-4")
        with patch.object(server, "fetch_json", return_value={"id": 4, "title": "Album", "tracks": {"data": [track]}}):
            album = server.get_collection_details("deezer-album-4", "album")
        self.assertEqual(album["songs"][0]["album"]["id"], "deezer-album-4")

    def test_radio_creates_station_and_excludes_seed_and_duplicates(self):
        second = jio_track("song-2")
        second["title"] = "Related Track"
        def jio(endpoint, params):
            if endpoint == "webradio.createEntityStation":
                self.assertEqual(json.loads(params["entity_id"]), ["song-1"])
                return {"stationid": "station-1"}
            self.assertEqual(params["stationid"], "station-1")
            return {"0": {"song": jio_track()}, "1": {"song": second}, "2": {"song": second}, "stationid": "station-1"}
        with patch.object(server, "jiosaavn_call", side_effect=jio), patch.object(server, "discovery_songs") as fallback:
            results = server.get_song_suggestions("song-1", "Artist", "Rock & Roll")
            fallback.assert_not_called()
        self.assertEqual([song["id"] for song in results], ["song-2"])

    def test_provider_fallback_recommendations_keep_seed_context(self):
        with patch.object(server, "jiosaavn_call") as jio, patch.object(server, "discovery_songs", return_value=[server.format_itunes_track(ITUNES)]) as search:
            results = server.get_song_suggestions("itunes-1", "Artist, Guest", "Seed", limit=2)
            jio.assert_not_called()
            search.assert_called_once_with("Artist", limit=6)
        self.assertEqual(results[0]["id"], "itunes-42")

    def test_recommendations_exclude_queued_tracks_before_applying_limit(self):
        songs = [server.format_itunes_track({**ITUNES, "trackId": index, "trackName": f"Track {index}"}) for index in range(1, 8)]
        excluded = [song["id"] for song in songs[:5]]
        with patch.object(server, "discovery_songs", return_value=songs) as search:
            results = server.get_song_suggestions("itunes-seed", "Artist", "Seed", "english", 2, excluded)
        self.assertEqual([song["id"] for song in results], ["itunes-6", "itunes-7"])
        search.assert_called_once_with("Artist", limit=7, timeout=2)

    def test_exhausted_artist_recommendations_widen_to_language_discovery(self):
        consumed = server.format_itunes_track(ITUNES)
        fresh = server.format_itunes_track({**ITUNES, "trackId": 99, "trackName": "Fresh Track"})
        with patch.object(server, "discovery_songs", side_effect=[[consumed], [consumed, fresh]]) as search:
            results = server.get_song_suggestions("itunes-seed", "Artist", "Seed", "hindi", 2, ["itunes-42"])
        self.assertEqual([song["id"] for song in results], ["itunes-99"])
        self.assertEqual([call.args[0] for call in search.call_args_list], ["Artist", "hindi songs"])
        self.assertTrue(all(call.kwargs["timeout"] == 2 for call in search.call_args_list))

    def test_native_radio_exclusions_trigger_artist_fallback_only_when_needed(self):
        consumed = jio_track()
        fresh = server.format_itunes_track(ITUNES)
        def jio(endpoint, params):
            return {"stationid": "s"} if endpoint == "webradio.createEntityStation" else {"0": {"song": consumed}}
        with patch.object(server, "jiosaavn_call", side_effect=jio), patch.object(server, "discovery_songs", return_value=[fresh]) as search:
            results = server.get_song_suggestions("song-seed", "Artist", "Seed", "hindi", 1, ["song-1"])
        self.assertEqual(results[0]["id"], "itunes-42")
        search.assert_called_once_with("Artist", limit=3, timeout=2)

    def test_total_provider_failure_has_empty_arrays_and_does_not_cache_failure(self):
        with patch.object(server, "jiosaavn_call", return_value=None), patch.object(server, "fetch_json", return_value=None):
            data = server.get_modules()
        self.assertFalse(any(data["availability"].values()))
        self.assertEqual(data["albums"], [])
        self.assertEqual(data["charts"], [])
        self.assertEqual(data["playlists"], [])
        self.assertNotIn("hindi,english", server.DISCOVERY_CACHE)

    @unittest.skipUnless(shutil.which("node"), "Node.js is unavailable")
    def test_node_discovery_helpers_without_external_dependencies(self):
        script = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const app = { get() {}, use() {}, listen() {} };
const express = () => app; express.static = () => {}; express.json = () => {};
const context = vm.createContext({ Buffer, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
    require(name) { return name === 'express' ? express : require(name); }, process: { env: {} }, __dirname: process.cwd(), fixture: JSON.parse(process.argv[1]) });
vm.runInContext(fs.readFileSync('server.js', 'utf8'), context);
vm.runInContext(`
(async () => {
    const song = formatSongPayload(fixture);
    if (song.source !== 'jiosaavn' || song.duration !== 210 || song.downloadUrl.at(-1).quality !== '320kbps') throw Error('Nested Jio/modern OpenSSL metadata regression');
    if (isAllowedMediaUrl('https://aac.saavncdn.com.evil.test/a') || isAllowedMediaUrl('https://localhost/a')) throw Error('Media proxy host regression');
    queryJioSaavn = async () => ({new_trending:[fixture],new_albums:[{id:'a',title:'Album'}],charts:[{id:'c',title:'Chart'}],top_playlists:[{id:'p',title:'Featured'}]});
    fetchJson = async () => null;
    const modules = await getModules('english');
    if (!Object.values(modules.availability).every(Boolean) || modules.playlists[0].id !== 'p') throw Error('Featured modules regression');
    queryJioSaavn = async () => ({id:'a',title:'Album',list:[fixture]});
    const album = await getCollectionDetails('a','album');
    if (album.songs.length !== 1) throw Error('Current album list envelope regression');
    queryJioSaavn = async endpoint => endpoint === 'webradio.createEntityStation' ? {stationid:'s'} : {'0':{song:fixture},'1':{song:{...fixture,id:'related',title:'Related'}},'2':{song:{...fixture,id:'related',title:'Related'}}};
    const related = await getSongSuggestions(fixture.id,'Artist','Rock & Roll');
    if (related.length !== 1 || related[0].id !== 'related') throw Error('Station recommendation deduplication regression');
    const candidates = Array.from({length:7}, (_,index) => ({...song,id:'itunes-'+index,name:'Track '+index}));
    discoverySongs = async () => candidates;
    const excluded = candidates.slice(0,5).map(item => item.id);
    const unheard = await getSongSuggestions('itunes-seed','Artist','Seed','english',2,excluded);
    if (unheard.length !== 2 || unheard[0].id !== 'itunes-5' || unheard[1].id !== 'itunes-6') throw Error('Exclusions must precede recommendation limit');
    const queries = [];
    discoverySongs = async (query,limit,timeout) => { queries.push(query); if (timeout !== 2000) throw Error('Recommendation fallback timeout regression'); return query === 'Artist' ? [candidates[0]] : [candidates[6]]; };
    const widened = await getSongSuggestions('itunes-seed','Artist','Seed','hindi',2,['itunes-0']);
    if (widened[0]?.id !== 'itunes-6' || queries.join('|') !== 'Artist|hindi songs') throw Error('Exhausted artist fallback must widen language discovery');
})().catch(error => { console.error(error); throw error; });`, context);
'''
        run = subprocess.run([shutil.which("node"), "-e", script, json.dumps(jio_track())], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=15)
        self.assertEqual(run.returncode, 0, run.stderr + run.stdout)


class MediaResponse(io.BytesIO):
    status = 206
    headers = {"Content-Type": "audio/mp4", "Content-Length": "4", "Content-Range": "bytes 0-3/100", "Accept-Ranges": "bytes"}


class HTTPTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is unavailable")
    def test_vercel_entrypoint_restores_nested_routes_and_query_parameters(self):
        script = r'''
const assert = require('node:assert/strict');
const http = require('node:http');
const handler = require('./api/index');
const server = http.createServer(handler);
server.listen(0, '127.0.0.1', async () => {
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const [path, status, message] of [
            ['/api?__bitgroove_path=health', 200, 'BitGroove'],
            ['/api?__bitgroove_path=yt%2Faudio%2Fbad', 400, 'Invalid YouTube video ID'],
            ['/api?__bitgroove_path=yt%2Fstream%2Fbad', 400, 'Invalid YouTube video ID'],
            ['/api?__bitgroove_path=search%2Fsongs&query=Artist&limit=0', 400, 'limit must be'],
            ['/api?__bitgroove_path=stream&url=bad', 400, 'Unsupported media URL'],
            ['/api?__bitgroove_path=unknown%2Fnested%2Froute', 404, 'API endpoint not found'],
            ['/api/health', 200, 'BitGroove']
        ]) {
            const response = await fetch(base + path);
            assert.equal(response.status, status, path);
            assert.match(response.headers.get('content-type'), /application\/json/);
            assert.ok((await response.text()).includes(message), path);
        }
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { server.close(); server.closeAllConnections(); }
});
'''
        result = subprocess.run([shutil.which("node"), "-e", script], cwd=pathlib.Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    @classmethod
    def setUpClass(cls):
        cls.httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), server.BitGrooveHandler)
        cls.httpd.daemon_threads = True
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:" + str(cls.httpd.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def test_health_and_unknown_api_return_json(self):
        with urllib.request.urlopen(self.base + "/api/health") as response:
            self.assertEqual(json.load(response)["data"]["name"], "BitGroove")
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/does-not-exist")
        self.assertEqual(error.exception.code, 404)
        self.assertEqual(error.exception.headers["Content-Type"], "application/json; charset=utf-8")
        error.exception.close()

    def test_recommendations_endpoint_forwards_seed_context(self):
        songs = [server.format_itunes_track(ITUNES)]
        with patch.object(server, "get_song_suggestions", return_value=songs) as recommendations:
            with urllib.request.urlopen(self.base + "/api/songs/itunes-1/suggestions?artist=Artist&name=Seed&language=english&limit=3") as response:
                self.assertEqual(json.load(response)["data"]["results"][0]["id"], "itunes-42")
            recommendations.assert_called_once_with("itunes-1", "Artist", "Seed", "english", 3)

    def test_recommendations_endpoint_forwards_json_exclusions(self):
        with patch.object(server, "get_song_suggestions", return_value=[]) as recommendations:
            with urllib.request.urlopen(self.base + "/api/songs/itunes-1/suggestions?artist=Artist&limit=2&exclude=%5B%22itunes-42%22%5D") as response:
                self.assertEqual(json.load(response)["data"]["results"], [])
            recommendations.assert_called_once_with("itunes-1", "Artist", "", "", 2, ["itunes-42"])

    def test_invalid_recommendation_exclusions_return_json400(self):
        with patch.object(server, "get_song_suggestions") as recommendations:
            for excluded in ("bogus", "%7B%7D", "%5B42%5D"):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(self.base + "/api/songs/itunes-1/suggestions?exclude=" + excluded)
                self.assertEqual(error.exception.code, 400)
                error.exception.close()
            recommendations.assert_not_called()

    def test_modules_accepts_both_language_query_spellings(self):
        with patch.object(server, "get_modules", return_value={}) as modules:
            for key in ("language", "languages"):
                with urllib.request.urlopen(self.base + "/api/modules?" + key + "=english") as response:
                    self.assertTrue(json.load(response)["success"])
                self.assertEqual(modules.call_args.args[0], "english")

    def test_invalid_limit_cannot_crash_a_request(self):
        for query in ("limit=NaN", "limit=-1", "limit=101", "page=-1", "page=nope"):
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.base + "/api/search/songs?query=test&" + query)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()

    def test_media_range_status_and_bytes_are_forwarded(self):
        request = urllib.request.Request(self.base + "/api/stream?url=https%3A%2F%2Faac.saavncdn.com%2Fa.mp4",
                                         headers={"Range": "bytes=0-3"})
        with patch.object(server.MEDIA_OPENER, "open", return_value=MediaResponse(b"test")) as upstream:
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.headers["Content-Range"], "bytes 0-3/100")
                self.assertEqual(response.read(), b"test")
            self.assertEqual(upstream.call_args.args[0].get_header("Range"), "bytes=0-3")

    def test_proxy_rejects_unapproved_destination_before_network(self):
        with patch.object(server.MEDIA_OPENER, "open") as upstream:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.base + "/api/stream?url=https%3A%2F%2Flocalhost%2Fa")
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            upstream.assert_not_called()

    def test_invalid_youtube_id_returns_json400(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/yt/stream/bad")
        self.assertEqual(error.exception.code, 400)
        error.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/api/yt/audio/bad")
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_youtube_audio_endpoint_redirects_to_resolved_audio(self):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, request, response, code, message, headers, new_url):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        stream_url = "https://rr.googlevideo.com/videoplayback?id=1"
        with patch.object(server, "resolve_youtube_audio_stream", return_value={"url": stream_url}) as resolve:
            with self.assertRaises(urllib.error.HTTPError) as error:
                opener.open(self.base + "/api/yt/audio/abcdefghijk")
            self.assertEqual(error.exception.code, 302)
            self.assertEqual(
                error.exception.headers["Location"],
                "/api/stream?url=" + urllib.parse.quote(stream_url, safe="")
            )
            self.assertEqual(error.exception.headers["Cache-Control"], "no-store")
            error.exception.close()
        resolve.assert_called_once_with("abcdefghijk")

    def test_youtube_audio_uses_same_origin_range_proxy(self):
        stream_url = "https://rr.googlevideo.com/videoplayback?id=1"
        request = urllib.request.Request(
            self.base + "/api/yt/audio/abcdefghijk",
            headers={"Range": "bytes=0-3"}
        )
        with patch.object(server, "resolve_youtube_audio_stream", return_value={"url": stream_url}), \
                patch.object(server.MEDIA_OPENER, "open", return_value=MediaResponse(b"test")) as upstream:
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.headers["Content-Range"], "bytes 0-3/100")
                self.assertEqual(response.read(), b"test")
            forwarded = upstream.call_args.args[0]
            self.assertEqual(forwarded.full_url, stream_url)
            self.assertEqual(forwarded.get_header("Range"), "bytes=0-3")

    def test_youtube_browser_requests_forward_bounded_ranges(self):
        stream_url = "https://rr.googlevideo.com/videoplayback?clen=4000000"
        for original, expected in ((None, "bytes=0-262143"), ("bytes=0-", "bytes=0-262143"), ("bytes=300000-", "bytes=300000-562143")):
            request = urllib.request.Request(self.base + "/api/yt/audio/VYOjWnS4cMY", headers={"Range": original} if original else {})
            with patch.object(server, "resolve_youtube_audio_stream", return_value={"url": stream_url}), \
                    patch.object(server.MEDIA_OPENER, "open", return_value=MediaResponse(b"test")) as upstream:
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.read(), b"test")
                self.assertEqual(upstream.call_args.args[0].get_header("Range"), expected)


if __name__ == "__main__":
    unittest.main()
