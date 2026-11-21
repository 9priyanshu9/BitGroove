"""
BitGroove - Python Music Proxy Server
Pure Python 3.12 standard library — no pip needed.
Sources: JioSaavn (DES-ECB) | Deezer | YouTube (Piped) | iTunes | Audius | lyrics.ovh
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import json
import os
import sys
import base64
import struct
import html
import re
import time
import threading
import concurrent.futures
import datetime
from collections import OrderedDict

PORT = int(os.environ.get("PORT", "3000"))
HOST = os.environ.get("BITGROOVE_HOST", "0.0.0.0")
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PROVIDER_TIMEOUT = 3
SEARCH_CACHE = OrderedDict()
SEARCH_CACHE_LOCK = threading.Lock()
DISCOVERY_CACHE = OrderedDict()
COLLECTION_CACHE = OrderedDict()
DISCOVERY_CACHE_LOCK = threading.Lock()

# ─── Minimal DES-ECB decryption (pure Python, no pycryptodome needed) ────────
# JioSaavn encrypts media URLs with DES-ECB key "38346591"
# We implement just enough DES to decrypt it.

def _expand_key(key8):
    """Generate 16 DES subkeys from 8-byte key (simplified key schedule)."""
    # Build 56-bit key from 8-byte key (ignore parity bits)
    pc1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,
           63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]
    pc2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,
           41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]
    shifts = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1]

    bits = []
    for b in key8:
        for i in range(7, -1, -1):
            bits.append((b >> i) & 1)

    # PC-1
    k = [bits[p-1] for p in pc1]
    C, D = k[:28], k[28:]

    def rot_left(lst, n):
        return lst[n:] + lst[:n]

    subkeys = []
    for shift in shifts:
        C = rot_left(C, shift)
        D = rot_left(D, shift)
        CD = C + D
        subkeys.append([CD[p-1] for p in pc2])
    return subkeys

def _des_block(block8, subkeys, decrypt=True):
    ip = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,
          57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]
    fp = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,
          36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]
    e  = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,
          24,25,26,27,28,29,28,29,30,31,32,1]
    p_box=[16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]
    sboxes=[
        [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
        [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
        [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
        [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
        [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
        [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
        [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
        [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
    ]

    bits = []
    for b in block8:
        for i in range(7, -1, -1):
            bits.append((b >> i) & 1)

    bits = [bits[p-1] for p in ip]
    L, R = bits[:32], bits[32:]

    ks = subkeys if not decrypt else list(reversed(subkeys))

    for sk in ks:
        R_exp = [R[p-1] for p in e]
        xored = [R_exp[i] ^ sk[i] for i in range(48)]
        s_out = []
        for s in range(8):
            chunk = xored[s*6:(s+1)*6]
            row = chunk[0]*2 + chunk[5]
            col = chunk[1]*8 + chunk[2]*4 + chunk[3]*2 + chunk[4]
            val = sboxes[s][row*16 + col]
            for i in range(3, -1, -1):
                s_out.append((val >> i) & 1)
        p_out = [s_out[p-1] for p in p_box]
        new_R = [L[i] ^ p_out[i] for i in range(32)]
        L, R = R, new_R

    bits_out = [fp[i] - 1 for i in range(64)]
    combined = R + L
    result_bits = [combined[fp[i]-1] for i in range(64)]
    result = bytearray(8)
    for i in range(8):
        for j in range(8):
            result[i] = (result[i] << 1) | result_bits[i*8+j]
    return bytes(result)

def des_ecb_decrypt(ciphertext_bytes, key8):
    if not ciphertext_bytes or len(ciphertext_bytes) % 8 or len(key8) != 8:
        raise ValueError("Invalid DES ciphertext or key length")
    subkeys = _expand_key(key8)
    result = b""
    for i in range(0, len(ciphertext_bytes), 8):
        result += _des_block(ciphertext_bytes[i:i+8], subkeys, decrypt=True)
    # Remove PKCS5 padding
    if result:
        pad = result[-1]
        if 1 <= pad <= 8 and result[-pad:] == bytes([pad]) * pad:
            result = result[:-pad]
    return result

def decrypt_jiosaavn_url(encrypted_b64):
    try:
        key = b"38346591"
        raw = base64.b64decode(encrypted_b64.strip(), validate=True)
        decrypted = des_ecb_decrypt(raw, key)
        url = decrypted.decode("utf-8")
        if url.startswith("http://"):
            url = "https://" + url[7:]
        return url if is_allowed_media_url(url) else ""
    except Exception:
        return ""

# ─── HTTP helpers ──────────────────────────────────────────────────────────────

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

def fetch_json(url, timeout=PROVIDER_TIMEOUT, extra_headers=None):
    hdrs = {**HEADERS, **(extra_headers or {})}
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return None
            return json.loads(r.read(4 * 1024 * 1024).decode("utf-8"))
    except Exception:
        return None

def fetch_json_post(url, payload, timeout=PROVIDER_TIMEOUT, extra_headers=None):
    hdrs = {**HEADERS, "Content-Type": "application/json", **(extra_headers or {})}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return None
            return json.loads(r.read(4 * 1024 * 1024).decode("utf-8"))
    except Exception:
        return None


MEDIA_SUFFIXES = ("saavncdn.com", "mzstatic.com", "dzcdn.net", "audius.co", "googlevideo.com")
MEDIA_HOSTS = {"audio-ssl.itunes.apple.com", "jiotunepreview.jio.com"}


def is_allowed_media_url(url):
    """Keep the streaming proxy limited to approved HTTPS media CDNs."""
    try:
        if not isinstance(url, str) or any(ord(c) < 32 for c in url):
            return False
        parsed = urllib.parse.urlsplit(url)
        host = (parsed.hostname or "").lower()
        return (parsed.scheme == "https" and not parsed.username and not parsed.password
                and parsed.port in (None, 443) and not parsed.fragment
                and (host in MEDIA_HOSTS or any(host == suffix or host.endswith("." + suffix)
                                               for suffix in MEDIA_SUFFIXES)))
    except (TypeError, ValueError):
        return False


class SafeMediaRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_allowed_media_url(newurl):
            raise urllib.error.HTTPError(newurl, 403, "Unsupported media redirect", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


MEDIA_OPENER = urllib.request.build_opener(SafeMediaRedirect())

YOUTUBE_AUDIO_CHUNK_SIZE = 256 * 1024


def youtube_media_range(url, range_header):
    """YouTube rejects unbounded downloads; expose bounded, seekable responses."""
    if not is_allowed_youtube_audio_url(url):
        return range_header
    parsed = urllib.parse.urlsplit(url)
    length = positive_int(urllib.parse.parse_qs(parsed.query).get("clen", [0])[0])
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header or "bytes=0-")
    if not match:
        return range_header
    first, last = match.groups()
    if not first:
        if not length:
            return range_header
        start = max(0, length - int(last))
        end = length - 1
    else:
        start = int(first)
        end = int(last) if last else start + YOUTUBE_AUDIO_CHUNK_SIZE - 1
    end = min(end, start + YOUTUBE_AUDIO_CHUNK_SIZE - 1)
    if length and start < length:
        end = min(end, length - 1)
    return f"bytes={start}-{end}"


def positive_int(value, default=0):
    try:
        return max(0, int(float(value)))
    except (ValueError, TypeError, OverflowError):
        return default


def text(value):
    return html.unescape(str(value or ""))

# ─── JioSaavn ─────────────────────────────────────────────────────────────────

JIOSAAVN_BASE = "https://www.jiosaavn.com/api.php"

def jiosaavn_call(endpoint_call, extra_params=None, timeout=PROVIDER_TIMEOUT):
    params = {
        "__call": endpoint_call,
        "_format": "json",
        "_marker": "0",
        "api_version": "4",
        "ctx": "web6dot0",
    }
    if extra_params:
        params.update(extra_params)
    url = JIOSAAVN_BASE + "?" + urllib.parse.urlencode(params)
    return fetch_json(url, timeout=timeout, extra_headers={"Referer": "https://www.jiosaavn.com/"})

def format_jiosaavn_song(raw):
    if not isinstance(raw, dict) or not raw:
        return None

    # JioSaavn API has two formats:
    # Old: encrypted_media_url at top level, song/album/primary_artists as fields
    # New: more_info dict contains encrypted_media_url, top level has title/subtitle
    mi = raw.get("more_info", {}) or {}
    if not isinstance(mi, dict):
        mi = {}

    enc = mi.get("encrypted_media_url") or raw.get("encrypted_media_url", "")
    decrypted_url = decrypt_jiosaavn_url(enc) if enc else ""

    download_urls = []
    if decrypted_url:
        parsed_url = urllib.parse.urlsplit(decrypted_url)
        base = re.sub(r"\.[a-zA-Z0-9]+$", "", parsed_url.path)
        ext_m = re.search(r"\.[a-zA-Z0-9]+$", parsed_url.path)
        ext = ext_m.group(0) if ext_m else ".mp4"
        clean_base = re.sub(r"_[0-9]+$", "", base)
        qualities = ["12", "48", "96", "160"]
        if mi.get("320kbps", raw.get("320kbps", "true")) in ("true", True):
            qualities.append("320")
        for q in qualities:
            link = urllib.parse.urlunsplit(parsed_url._replace(path=f"{clean_base}_{q}{ext}"))
            download_urls.append({"quality": f"{q}kbps", "link": link})
    elif mi.get("vlink"):  # JioTune preview fallback
        download_urls.append({"quality": "128kbps", "link": mi["vlink"]})
    elif raw.get("media_preview_url"):
        download_urls.append({"quality": "160kbps", "link": raw["media_preview_url"]})
    download_urls = [entry for entry in download_urls if is_allowed_media_url(entry["link"])]
    is_preview = bool(download_urls) and not bool(decrypted_url)

    # Image: new API provides array or string
    img = raw.get("image", "")
    if isinstance(img, list):
        # Sometimes image is array of dicts
        img = (img[-1].get("link") or img[-1].get("url") or "") if img and isinstance(img[-1], dict) else ""
    images = []
    if img:
        def _swap(url, size):
            import re
            return re.sub(r"\d+x\d+", size, url)
        images = [
            {"quality": "50x50",   "link": _swap(img, "50x50")},
            {"quality": "150x150", "link": _swap(img, "150x150")},
            {"quality": "500x500", "link": _swap(img, "500x500")},
        ]

    # Artists: new format has artistMap in more_info
    primary_artists = ""
    artist_map = mi.get("artistMap") or {}
    if isinstance(artist_map, dict) and artist_map.get("primary_artists"):
        primary_artists = ", ".join(a.get("name","") for a in artist_map["primary_artists"] if isinstance(a, dict) and a.get("name"))
    if not primary_artists:
        primary_artists = mi.get("music") or raw.get("primary_artists") or raw.get("singers") or raw.get("music") or ""
        # subtitle often contains "Artist - Album"
        if not primary_artists and raw.get("subtitle"):
            parts = raw["subtitle"].split(" - ")
            if parts:
                primary_artists = parts[0].strip()

    album_name = mi.get("album") or raw.get("album") or ""
    album_id   = mi.get("album_id") or raw.get("albumid") or ""
    duration   = positive_int(mi.get("duration") or raw.get("duration"))

    return {
        "id": str(raw.get("id", "")),
        "name": text(raw.get("song") or raw.get("title") or raw.get("name")),
        "album": {"id": str(album_id), "name": text(album_name)},
        "year": raw.get("year") or (mi.get("release_date") or "")[:4] or "",
        "duration": 30 if is_preview else duration,
        "originalDuration": duration,
        "isPreview": is_preview,
        "primaryArtists": text(primary_artists),
        "language": text(raw.get("language") or mi.get("language")),
        "image": images if images else [{"quality": "500x500", "link": img}],
        "downloadUrl": download_urls,
        "hasLyrics": mi.get("has_lyrics") in ("true", True) or raw.get("has_lyrics") in ("true", True),
        "source": "jiosaavn"
    }

# ─── YouTube (InnerTube Official Web Search - 100% Free & Fast) ───────────────

def youtube_innertube_search(query, limit=25):
    url = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false"
    payload = {
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20240101.01.00"
            }
        },
        "query": query
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            res = json.loads(resp.read().decode("utf-8"))

        items = res.get("contents", {}).get("twoColumnSearchResultsRenderer", {}).get("primaryContents", {}).get("sectionListRenderer", {}).get("contents", [])
        results = []
        for sec in items:
            for v in sec.get("itemSectionRenderer", {}).get("contents", []):
                vr = v.get("videoRenderer")
                if not vr: continue
                vid = vr.get("videoId")
                title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", []))
                owner = "".join(r.get("text", "") for r in vr.get("ownerText", {}).get("runs", []))
                dur_txt = vr.get("lengthText", {}).get("simpleText", "")
                dur_sec = 0
                if dur_txt:
                    parts = dur_txt.split(":")
                    try:
                        if len(parts) == 2:
                            dur_sec = int(parts[0]) * 60 + int(parts[1])
                        elif len(parts) == 3:
                            dur_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                    except:
                        pass
                thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
                thumb = thumbs[-1].get("url") if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                if vid and title and re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
                    results.append({
                        "id": f"yt-{vid}",
                        "ytId": vid,
                        "name": title,
                        "primaryArtists": owner or "YouTube",
                        "album": {"name": "YouTube Music"},
                        "year": "",
                        "duration": dur_sec,
                        "durationText": dur_txt,
                        "image": [{"quality": "500x500", "link": thumb}],
                        "downloadUrl": [],
                        "hasLyrics": False,
                        "source": "youtube",
                        "isPreview": False
                    })
                    if len(results) >= limit:
                        break
            if len(results) >= limit:
                break
        return results
    except Exception as e:
        print("YouTube search error:", e)
        return []

PIPED_INSTANCES = (
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.leptons.xyz",
    "https://api.piped.yt",
)

YOUTUBE_PLAYER_CLIENTS = (
    {
        "clientName": "ANDROID",
        "clientVersion": "20.10.38",
        "androidSdkVersion": 35,
        "userAgent": "com.google.android.youtube/20.10.38 (Linux; U; Android 15; en_US; sdk_gphone64_x86_64 Build/AP3A.241005.015.A2) gzip",
    },
    {
        "clientName": "IOS",
        "clientVersion": "20.10.4",
        "deviceMake": "Apple",
        "deviceModel": "iPhone16,2",
        "osName": "iPhone",
        "osVersion": "18.0.0.22A3354",
    },
)

def is_allowed_youtube_audio_url(url):
    try:
        parsed = urllib.parse.urlparse(url)
        host = (parsed.hostname or "").lower()
        return (
            parsed.scheme == "https"
            and (host == "googlevideo.com" or host.endswith(".googlevideo.com"))
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        )
    except (TypeError, ValueError):
        return False


def youtube_audio_rank(stream):
    # AAC works across desktop and mobile browsers; bitrate alone can pick WebM.
    mime_type = stream.get("mimeType", "")
    aac = mime_type.startswith("audio/mp4") and ("codecs=" not in mime_type or "mp4a" in mime_type)
    return (aac, positive_int(stream.get("averageBitrate") or stream.get("bitrate")))

def resolve_youtube_audio_stream(video_id):
    for client in YOUTUBE_PLAYER_CLIENTS:
        payload = fetch_json_post(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            {
                "context": {"client": {**client, "hl": "en", "gl": "US"}},
                "videoId": video_id,
                "contentCheckOk": True,
                "racyCheckOk": True,
            },
            timeout=8,
            extra_headers={
                "Origin": "https://www.youtube.com",
                "Referer": "https://www.youtube.com/",
            },
        )
        if not isinstance(payload, dict) or payload.get("playabilityStatus", {}).get("status") != "OK":
            continue
        streams = []
        for stream in (payload.get("streamingData") or {}).get("adaptiveFormats", []):
            if not isinstance(stream, dict) or not stream.get("mimeType", "").startswith("audio/") or not is_allowed_youtube_audio_url(stream.get("url")):
                continue
            try:
                bitrate = max(0, int(stream.get("averageBitrate") or stream.get("bitrate") or 0))
            except (TypeError, ValueError):
                bitrate = 0
            streams.append((bitrate, stream))
        if streams:
            bitrate, stream = max(streams, key=lambda item: youtube_audio_rank(item[1]))
            return {
                "url": stream["url"],
                "bitrate": bitrate,
                "mimeType": stream["mimeType"],
            }

    for base in PIPED_INSTANCES:
        payload = fetch_json(f"{base}/streams/{video_id}", timeout=8)
        if not isinstance(payload, dict):
            continue
        streams = []
        for stream in payload.get("audioStreams", []):
            if not isinstance(stream, dict) or stream.get("videoOnly") or not is_allowed_youtube_audio_url(stream.get("url")):
                continue
            try:
                bitrate = max(0, int(stream.get("bitrate") or 0))
            except (TypeError, ValueError):
                bitrate = 0
            streams.append((bitrate, stream))
        if streams:
            bitrate, stream = max(streams, key=lambda item: youtube_audio_rank(item[1]))
            return {
                "url": stream["url"],
                "bitrate": bitrate,
                "mimeType": stream.get("mimeType") or "audio/webm",
            }
    return None

# ─── Deezer ───────────────────────────────────────────────────────────────────

def format_deezer_track(t):
    if not isinstance(t, dict) or not t.get("id") or not is_allowed_media_url(t.get("preview")):
        return None
    return {
        "id": f"deezer-{t['id']}",
        "name": text(t.get("title")),
        "primaryArtists": text((t.get("artist") or {}).get("name")),
        "album": {"id": f"deezer-album-{t['album']['id']}" if (t.get("album") or {}).get("id") else "", "name": text((t.get("album") or {}).get("title"))},
        "year": "",
        "duration": 30,
        "originalDuration": positive_int(t.get("duration")),
        "isPreview": True,
        "image": [
            {"quality": "150x150", "link": (t.get("album") or {}).get("cover_medium", "")},
            {"quality": "500x500", "link": (t.get("album") or {}).get("cover_xl") or (t.get("album") or {}).get("cover_big") or (t.get("album") or {}).get("cover_medium", "")},
        ],
        "downloadUrl": [{"quality": "128kbps", "link": t["preview"]}],
        "hasLyrics": False,
        "source": "deezer"
    }


def format_itunes_track(item):
    if not isinstance(item, dict) or not item.get("trackId") or not is_allowed_media_url(item.get("previewUrl")):
        return None
    return {
        "id": f"itunes-{item['trackId']}",
        "name": text(item.get("trackName")),
        "primaryArtists": text(item.get("artistName")),
        "album": {"id": f"itunes-album-{item['collectionId']}" if item.get("collectionId") else "", "name": text(item.get("collectionName"))},
        "year": (item.get("releaseDate") or "")[:4],
        "duration": 30,
        "originalDuration": round(positive_int(item.get("trackTimeMillis")) / 1000),
        "isPreview": True,
        "image": [{"quality": "500x500", "link": (item.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")}],
        "downloadUrl": [{"quality": "preview", "link": item["previewUrl"]}],
        "hasLyrics": False,
        "source": "itunes"
    }


def format_audius_track(track):
    if not isinstance(track, dict) or not track.get("id") or not track.get("is_streamable", True):
        return None
    artwork = track.get("artwork") or {}
    return {
        "id": f"audius-{track['id']}",
        "name": text(track.get("title")),
        "primaryArtists": text((track.get("user") or {}).get("name")),
        "album": {"name": "Audius"},
        "year": (track.get("release_date") or "")[:4],
        "duration": positive_int(track.get("duration")),
        "isPreview": False,
        "image": [{"quality": "500x500", "link": artwork.get("480x480") or artwork.get("150x150") or ""}],
        "downloadUrl": [{"quality": "stream", "link": f"https://discoveryprovider.audius.co/v1/tracks/{urllib.parse.quote(str(track['id']), safe='')}/stream?app_name=BitGroove"}],
        "hasLyrics": False,
        "source": "audius"
    }


def search_songs(query, page=0, limit=30):
    """Return a playable provider result without waiting for unrelated providers."""
    query = query.strip()
    if not query:
        return []
    cache_key = (query.casefold(), page, limit)
    with SEARCH_CACHE_LOCK:
        cached = SEARCH_CACHE.get(cache_key)
        if cached and time.monotonic() - cached[0] < 300:
            SEARCH_CACHE.move_to_end(cache_key)
            return cached[1]

    providers = [
        (lambda: jiosaavn_call("search.getResults", {"q": query, "p": str(page + 1), "n": str(limit)}), "results", format_jiosaavn_song),
        (lambda: fetch_json("https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": query, "entity": "song", "limit": limit})), "results", format_itunes_track),
        (lambda: fetch_json("https://api.deezer.com/search?" + urllib.parse.urlencode({"q": query, "limit": limit, "index": page * limit})), "data", format_deezer_track),
        (lambda: fetch_json("https://discoveryprovider.audius.co/v1/tracks/search?" + urllib.parse.urlencode({"query": query, "limit": limit, "offset": page * limit, "app_name": "BitGroove"})), "data", format_audius_track)
    ]
    for fetch_provider, key, formatter in providers:
        try:
            payload = fetch_provider()
            records = payload.get(key) if isinstance(payload, dict) else None
            if not isinstance(records, list):
                continue
            results = []
            for record in records:
                try:
                    song = formatter(record)
                    if song and song.get("id") and song.get("downloadUrl"):
                        results.append(song)
                except (ValueError, TypeError, AttributeError, KeyError):
                    continue
            if results:
                results = results[:limit]
                with SEARCH_CACHE_LOCK:
                    SEARCH_CACHE[cache_key] = (time.monotonic(), results)
                    SEARCH_CACHE.move_to_end(cache_key)
                    while len(SEARCH_CACHE) > 128:
                        SEARCH_CACHE.popitem(last=False)
                return results
        except Exception:
            continue
    return []

# ─── Main Handler ──────────────────────────────────────────────────────────────

def artwork_images(value):
    if isinstance(value, list):
        value = next((item.get("link") or item.get("url") for item in reversed(value)
                      if isinstance(item, dict) and (item.get("link") or item.get("url"))), "")
    return [{"quality": "500x500", "link": re.sub(r"\d+x\d+", "500x500", value if isinstance(value, str) else "")}]


def records(payload, *keys):
    """Accept both current and legacy provider collection envelopes."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                result = records(value, "data", "list", "songs", "results")
                if result:
                    return result
    return []


def playable_records(payload, formatter=format_jiosaavn_song):
    result, seen = [], set()
    for raw in records(payload, "songs", "list", "results", "data"):
        try:
            song = formatter(raw)
            if song and song.get("id") and song.get("downloadUrl") and song["id"] not in seen:
                seen.add(song["id"])
                result.append(song)
        except (TypeError, ValueError, AttributeError, KeyError):
            continue
    return result


def format_collection(raw, kind="playlist", source="jiosaavn"):
    if not isinstance(raw, dict) or not raw.get("id"):
        return None
    info = raw.get("more_info") if isinstance(raw.get("more_info"), dict) else {}
    artist = raw.get("artist") or ""
    if isinstance(artist, dict):
        artist = artist.get("name", "")
    result = {"id": str(raw["id"]) if source == "jiosaavn" else f"{source}-{kind}-{raw['id']}",
              "name": text(raw.get("title") or raw.get("name") or raw.get("album")),
              "artist": text(raw.get("primary_artists") or raw.get("music") or raw.get("subtitle") or artist),
              "year": str(raw.get("year") or raw.get("release_date") or "")[:4],
              "releaseDate": raw.get("release_date") or info.get("release_date") or "",
              "description": text(raw.get("description") or info.get("description")),
              "image": artwork_images(raw.get("image") or raw.get("picture_xl") or raw.get("cover_xl") or raw.get("cover_big") or ""),
              "songCount": positive_int(info.get("song_count") or raw.get("song_count") or raw.get("nb_tracks")),
              "source": source, "type": kind}
    return result if result["name"] else None


def merge_cards(*groups):
    result, seen = [], set()
    for group in groups:
        for card in group:
            if card and card["id"] not in seen:
                seen.add(card["id"])
                result.append(card)
    return result


def discovery_songs(query, limit=24, timeout=PROVIDER_TIMEOUT):
    """Bound shelf/radio fallback latency to one provider timeout, preferring full streams."""
    loaders = [
        (lambda: jiosaavn_call("search.getResults", {"q": query, "p": "1", "n": str(limit)}, timeout=timeout), format_jiosaavn_song),
        (lambda: fetch_json("https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": query, "entity": "song", "limit": limit}), timeout=timeout), format_itunes_track),
        (lambda: fetch_json("https://api.deezer.com/search?" + urllib.parse.urlencode({"q": query, "limit": limit}), timeout=timeout), format_deezer_track)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [(pool.submit(load), formatter) for load, formatter in loaders]
        for future, formatter in futures:
            try:
                songs = playable_records(future.result(), formatter)
                if songs:
                    return songs[:limit]
            except Exception:
                continue
    return []


def get_modules(languages="hindi,english"):
    languages = ",".join(part.strip().lower() for part in languages.split(",") if re.fullmatch(r"[a-z]+", part.strip().lower())) or "hindi,english"
    with DISCOVERY_CACHE_LOCK:
        cached = DISCOVERY_CACHE.get(languages)
        if cached and time.monotonic() - cached[0] < 600:
            return cached[1]

    def load_home():
        result = {"trending": [], "albums": [], "charts": [], "playlists": []}
        for endpoint in ("webapi.getLaunchData", "content.getHomepageData"):
            data = jiosaavn_call(endpoint, {"languages": languages}) or {}
            if not isinstance(data, dict):
                continue
            result["trending"] = result["trending"] or playable_records(data.get("new_trending") or data.get("trending") or [])
            for key, names, kind in (("albums", ("new_albums", "new_releases"), "album"), ("charts", ("charts",), "playlist"),
                                     ("playlists", ("top_playlists", "featured_playlists", "playlists"), "playlist")):
                cards = [format_collection(raw, kind) for module in names for raw in records(data.get(module), "data", "list", "results")
                         if isinstance(raw, dict) and (key != "albums" or raw.get("type", "album") != "song")]
                result[key] = merge_cards(result[key], cards)
            if all(result.values()):
                break
        return result

    # Each shelf has an independent provider so one outage cannot blank the home page.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(load_home), pool.submit(fetch_json, "https://api.deezer.com/chart/0"),
                   pool.submit(fetch_json, "https://api.deezer.com/editorial/0/releases?limit=16")]
        loaded = []
        for future in futures:
            try:
                loaded.append(future.result() or {})
            except Exception:
                loaded.append({})
    home, deezer, releases = loaded
    chart_songs = playable_records(deezer.get("tracks") or [], format_deezer_track)
    trending = home.get("trending") or chart_songs
    albums = merge_cards(home.get("albums", []), [format_collection(raw, "album", "deezer") for raw in records(releases, "data")])[:16]
    charts = home.get("charts", [])
    if not charts and chart_songs:
        charts = [{"id": "deezer-chart-global", "name": "Deezer Top Tracks", "description": "The current global chart on Deezer. 30-second previews.",
                   "image": chart_songs[0]["image"], "source": "deezer", "type": "playlist", "songs": chart_songs, "songCount": len(chart_songs)}]
    playlists = merge_cards(home.get("playlists", []), [format_collection(raw, "playlist", "deezer") for raw in records(deezer.get("playlists"), "data")])[:12]

    def album_fallback():
        data = fetch_json("https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": "hindi music" if "hindi" in languages else "new music", "entity": "album", "limit": 50})) or {}
        cutoff = (datetime.date.today() - datetime.timedelta(days=180)).isoformat()
        cards = []
        for raw in records(data, "results"):
            if not isinstance(raw, dict) or not raw.get("collectionId") or str(raw.get("releaseDate") or "")[:10] < cutoff:
                continue
            cards.append({"id": f"itunes-album-{raw['collectionId']}", "name": text(raw.get("collectionName")), "artist": text(raw.get("artistName")),
                          "year": str(raw.get("releaseDate") or "")[:4], "releaseDate": raw.get("releaseDate", ""), "source": "itunes", "type": "album",
                          "image": artwork_images((raw.get("artworkUrl100") or "").replace("100x100bb", "600x600bb"))})
        return sorted(cards, key=lambda item: item["releaseDate"], reverse=True)[:16]

    def playlist_search(query):
        data = jiosaavn_call("search.getPlaylistResults", {"q": query, "p": "1", "n": "8"}) or {}
        return [card for raw in records(data, "results") if (card := format_collection(raw))]

    def playlist_fallback():
        cards = playlist_search("Hindi hits" if "hindi" in languages else "Chill")
        if cards:
            return cards
        songs = discovery_songs("acoustic chill", limit=16)
        return [{"id": "bitgroove-mix-acoustic", "name": "Acoustic Moments", "description": "A BitGroove listening mix for a quieter moment.",
                 "source": "bitgroove", "type": "playlist", "image": songs[0]["image"], "songs": songs, "songCount": len(songs)}] if songs else []

    values = {"trending": trending, "albums": albums, "charts": charts, "playlists": playlists}
    fallbacks = {"trending": lambda: discovery_songs("Hindi hits" if "hindi" in languages else "Pop hits", limit=24),
                 "albums": album_fallback, "charts": lambda: playlist_search("Top 50"), "playlists": playlist_fallback}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pending = {key: pool.submit(fallbacks[key]) for key, value in values.items() if not value}
        for key, future in pending.items():
            try:
                values[key] = future.result()
            except Exception:
                values[key] = []
    result = {"trending": {"songs": values["trending"]}, "albums": values["albums"], "charts": values["charts"],
              "playlists": values["playlists"], "featuredPlaylists": values["playlists"], "availability": {key: bool(value) for key, value in values.items()}}
    with DISCOVERY_CACHE_LOCK:
        for card in values["albums"] + values["charts"] + values["playlists"]:
            COLLECTION_CACHE[card["id"]] = (time.monotonic(), card)
        while len(COLLECTION_CACHE) > 256:
            COLLECTION_CACHE.popitem(last=False)
        if all(values.values()):
            DISCOVERY_CACHE[languages] = (time.monotonic(), result)
            while len(DISCOVERY_CACHE) > 16:
                DISCOVERY_CACHE.popitem(last=False)
    return result


def get_collection_details(collection_id, kind):
    with DISCOVERY_CACHE_LOCK:
        cached = COLLECTION_CACHE.get(collection_id)
        if cached and time.monotonic() - cached[0] < 1800 and cached[1].get("songs"):
            return cached[1]
    if collection_id == "deezer-chart-global":
        songs = playable_records(fetch_json("https://api.deezer.com/chart/0/tracks?limit=50"), format_deezer_track)
        return {"id": collection_id, "name": "Deezer Top Tracks", "source": "deezer", "type": "playlist", "songs": songs,
                "image": songs[0]["image"] if songs else []} if songs else None
    prefix = f"deezer-{kind}-"
    if collection_id.startswith(prefix) and collection_id[len(prefix):].isdigit():
        raw = fetch_json(f"https://api.deezer.com/{kind}/{collection_id[len(prefix):]}")
        card = format_collection(raw, kind, "deezer")
        if not card:
            return None
        songs = playable_records((raw or {}).get("tracks"), format_deezer_track)
        if kind == "album":
            for song in songs:
                song["album"] = {"id": collection_id, "name": card["name"]}
                if not any(item.get("link") for item in song["image"]):
                    song["image"] = card["image"]
        card["songs"] = songs
        return card if songs else None
    itunes_id = collection_id[len("itunes-album-"):] if collection_id.startswith("itunes-album-") else collection_id
    if not collection_id.startswith("itunes-"):
        call, params = ("content.getAlbumDetails", {"albumid": collection_id}) if kind == "album" else ("playlist.getDetails", {"listid": collection_id, "n": "100"})
        raw = jiosaavn_call(call, params)
        card, songs = format_collection(raw, kind), playable_records(raw)
        if card and songs:
            card["songs"] = songs
            return card
    if kind == "album" and itunes_id.isdigit():
        items = records(fetch_json("https://itunes.apple.com/lookup?" + urllib.parse.urlencode({"id": itunes_id, "entity": "song"})), "results")
        songs = playable_records(items, format_itunes_track)
        if items and songs:
            info = items[0]
            return {"id": collection_id, "name": text(info.get("collectionName")), "artist": text(info.get("artistName")), "source": "itunes", "type": "album",
                    "year": str(info.get("releaseDate") or "")[:4], "image": artwork_images((info.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")), "songs": songs}
    return None


def get_song_suggestions(song_id, artist="", name="", language="", limit=12, exclude=None):
    excluded = [value for value in (exclude or [])[:100] if isinstance(value, str)]
    result, seen = [], {song_id, *excluded}

    def accept(candidates):
        for song in candidates:
            identity = (song.get("name", "").casefold(), song.get("primaryArtists", "").casefold())
            if song["id"] in seen or identity in seen or (name and song.get("name", "").casefold() == name.casefold()):
                continue
            seen.update((song["id"], identity))
            result.append(song)
            if len(result) >= limit:
                break
        return bool(result)

    candidates = min(100, max(limit * 3, limit + len(excluded)))
    if not song_id.startswith(("itunes-", "deezer-", "audius-", "yt-", "curated-")):
        try:
            station = jiosaavn_call("webradio.createEntityStation", {"entity_id": json.dumps([song_id]), "entity_type": "queue"}) or {}
            if station.get("stationid"):
                radio = jiosaavn_call("webradio.getSong", {"stationid": station["stationid"], "k": str(min(50, candidates)), "next": "1"}) or {}
                if accept(playable_records([item["song"] for item in radio.values() if isinstance(item, dict) and isinstance(item.get("song"), dict)])):
                    return result
        except Exception:
            pass

    def discover(query):
        # Additional exhausted-queue fallback keeps the full request inside the client's 12s budget.
        return discovery_songs(query, limit=candidates, timeout=2) if exclude is not None else discovery_songs(query, limit=candidates)

    query = artist.split(",")[0].strip() or name.strip()
    if query and accept(discover(query)):
        return result
    # Widen discovery only after the seed artist/radio offers no unheard tracks.
    language = language.split(",")[0].strip().lower()
    broad_query = f"{language} songs" if re.fullmatch(r"[a-z]+", language) and language != "english" else "pop hits"
    if broad_query.casefold() != query.casefold():
        accept(discover(broad_query))
    return result


class BitGrooveHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass  # Suppress verbose request logs

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")

    def send_json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def stream_media(self, url, head=False):
        if not is_allowed_media_url(url):
            return self.send_json({"success": False, "error": "Unsupported media URL"}, 400)
        headers = {**HEADERS, "Accept": "audio/*,video/mp4,application/octet-stream", "Accept-Encoding": "identity"}
        range_header = self.headers.get("Range")
        if range_header:
            if not re.fullmatch(r"bytes=\d*-\d*", range_header) or range_header == "bytes=-":
                return self.send_json({"success": False, "error": "Invalid range"}, 400)
        if not head:
            range_header = youtube_media_range(url, range_header)
        if range_header:
            headers["Range"] = range_header
        request = urllib.request.Request(url, headers=headers, method="HEAD" if head else "GET")
        try:
            upstream = MEDIA_OPENER.open(request, timeout=8)
        except urllib.error.HTTPError as exc:
            status = 416 if exc.code == 416 else 502
            if status == 416:
                self.send_response(status)
                if exc.headers.get("Content-Range"):
                    self.send_header("Content-Range", exc.headers["Content-Range"])
                self.send_header("Content-Length", "0")
                self._cors()
                self.end_headers()
                return
            return self.send_json({"success": False, "error": "Music source is unavailable"}, status)
        except (urllib.error.URLError, TimeoutError, OSError):
            return self.send_json({"success": False, "error": "Music source timed out"}, 502)
        with upstream:
            if upstream.status not in (200, 206):
                return self.send_json({"success": False, "error": "Invalid music source response"}, 502)
            content_type = upstream.headers.get("Content-Type", "application/octet-stream")
            if not (content_type.startswith("audio/") or content_type.split(";")[0] in ("video/mp4", "application/octet-stream", "binary/octet-stream")):
                return self.send_json({"success": False, "error": "Music source did not return audio"}, 502)
            self.send_response(upstream.status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "private, max-age=300")
            for name in ("Content-Length", "Content-Range", "Accept-Ranges"):
                value = upstream.headers.get(name)
                if value:
                    self.send_header(name, value)
            self._cors()
            self.end_headers()
            if head:
                return
            try:
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError, OSError):
                self.close_connection = True

    def do_HEAD(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/api/stream":
            values = urllib.parse.parse_qs(parsed.query).get("url", [""])
            return self.stream_media(values[0], head=True)
        return super().do_HEAD()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        def p(key, default=""):
            vals = params.get(key, [default])
            return vals[0] if vals else default

        if path.startswith("/api/"):
            try:
                limit = int(p("limit", "30"))
                page = int(p("page", "0"))
                if not 1 <= limit <= 100 or not 0 <= page <= 1000:
                    raise ValueError()
            except ValueError:
                return self.send_json({"success": False, "error": "limit must be 1-100 and page must be 0-1000"}, 400)

        if path == "/api/health":
            return self.send_json({"success": True, "data": {"name": "BitGroove", "runtime": "python", "sources": ["jiosaavn", "itunes", "deezer", "audius", "youtube"]}})

        if path == "/api/stream":
            return self.stream_media(p("url"))

        # ── Song Search (JioSaavn 320kbps + YouTube Music InnerTube) ───────────
        if path == "/api/search/songs":
            query = p("query") or p("q")
            if not query.strip():
                return self.send_json({"success": True, "data": {"results": []}})
            results = search_songs(query, page=page, limit=limit)
            return self.send_json({"success": True, "data": {"results": results}})

        # ── Deezer Search ─────────────────────────────────────────────────────
        if path == "/api/deezer/search":
            query = p("q")
            if not query.strip():
                return self.send_json({"success": True, "data": {"results": []}})
            try:
                data = fetch_json(f"https://api.deezer.com/search?q={urllib.parse.quote(query)}&limit={limit}")
                results = [format_deezer_track(t) for t in (data or {}).get("data", [])]
                results = [r for r in results if r]
                return self.send_json({"success": True, "data": {"results": results}})
            except Exception as e:
                return self.send_json({"success": True, "data": {"results": []}})

        # ── Deezer Charts ─────────────────────────────────────────────────────
        if path == "/api/deezer/charts":
            try:
                data = fetch_json("https://api.deezer.com/chart/0/tracks?limit=50")
                results = [format_deezer_track(t) for t in (data or {}).get("data", [])]
                results = [r for r in results if r]
                return self.send_json({"success": True, "data": {"results": results}})
            except Exception:
                return self.send_json({"success": True, "data": {"results": []}})

        # ── YouTube Dedicated Search (InnerTube) ──────────────────────────────
        if path == "/api/yt/search":
            query = p("q") or p("query")
            if not query.strip():
                return self.send_json({"success": True, "data": {"results": []}})
            results = youtube_innertube_search(query, limit=limit)
            return self.send_json({"success": True, "data": {"results": results}})

        # ── YouTube audio stream ──────────────────────────────────────────────
        if path.startswith("/api/yt/audio/"):
            video_id = path.split("/api/yt/audio/")[-1]
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                return self.send_json({"success": False, "error": "Invalid YouTube video ID"}, 400)
            stream = resolve_youtube_audio_stream(video_id)
            if not stream:
                return self.send_json({"success": False, "error": "Could not resolve YouTube audio"}, 502)
            self.send_response(302)
            self.send_header("Location", "/api/stream?" + urllib.parse.urlencode({"url": stream["url"]}))
            self.send_header("Cache-Control", "no-store")
            return self.end_headers()

        # ── YouTube stream metadata ───────────────────────────────────────────
        if path.startswith("/api/yt/stream/"):
            video_id = path.split("/api/yt/stream/")[-1]
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                return self.send_json({"success": False, "error": "Invalid YouTube video ID"}, 400)
            stream = resolve_youtube_audio_stream(video_id)
            if not stream:
                return self.send_json({"success": False, "error": "Could not resolve YouTube audio"}, 502)
            return self.send_json({"success": True, "data": stream})

        # ── Albums Search ─────────────────────────────────────────────────────
        if path == "/api/search/albums":
            query = p("query")
            try:
                # Try JioSaavn first
                jio = jiosaavn_call("search.getAlbumResults", {"q": query, "p": "1", "n": "20"})
                if jio and jio.get("results"):
                    results = []
                    for a in jio["results"]:
                        img = (a.get("image") or "").replace("150x150","500x500").replace("50x50","500x500")
                        results.append({"id": a.get("id",""), "name": a.get("album") or a.get("title") or "", "artist": a.get("music") or a.get("primary_artists") or "", "year": a.get("year",""), "image": [{"quality":"500x500","link":img}]})
                    return self.send_json({"success": True, "data": {"results": results}})
            except Exception:
                pass
            # Fallback iTunes
            try:
                data = fetch_json(f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&entity=album&limit=20")
                results = []
                for item in (data or {}).get("results", []):
                    artwork = (item.get("artworkUrl100") or "").replace("100x100bb","600x600bb")
                    results.append({"id": str(item.get("collectionId","")), "name": item.get("collectionName",""), "artist": item.get("artistName",""), "year": (item.get("releaseDate") or "")[:4], "image": [{"quality":"500x500","link":artwork}]})
                return self.send_json({"success": True, "data": {"results": results}})
            except Exception:
                return self.send_json({"success": True, "data": {"results": []}})

        # ── Artists Search ────────────────────────────────────────────────────
        if path == "/api/search/artists":
            query = p("query")
            try:
                data = fetch_json(f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&entity=musicArtist&limit=20")
                results = [{"id": str(i.get("artistId","")), "name": i.get("artistName",""), "image": [{"quality":"500x500","link":"https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500"}]} for i in (data or {}).get("results", [])]
                return self.send_json({"success": True, "data": {"results": results}})
            except Exception:
                return self.send_json({"success": True, "data": {"results": []}})

        # ── Playlists Search ──────────────────────────────────────────────────
        if path == "/api/search/playlists":
            query = p("query")
            try:
                jio = jiosaavn_call("search.getPlaylistResults", {"q": query, "p": "1", "n": "20"})
                if jio and jio.get("results"):
                    results = [{"id": p_.get("id",""), "name": p_.get("title") or p_.get("name",""), "image": [{"quality":"500x500","link":(p_.get("image","")).replace("150x150","500x500")}]} for p_ in jio["results"]]
                    return self.send_json({"success": True, "data": {"results": results}})
            except Exception:
                pass
            return self.send_json({"success": True, "data": {"results": []}})

        # ── Song Lyrics (JioSaavn) ────────────────────────────────────────────
        if path.startswith("/api/songs/") and path.endswith("/suggestions"):
            song_id = urllib.parse.unquote(path[len("/api/songs/"):-len("/suggestions")])
            if not song_id or "/" in song_id:
                return self.send_json({"success": False, "error": "Invalid song ID"}, 400)
            args = (song_id, p("artist"), p("name") or p("title"), p("language"), limit)
            if "exclude" in params:
                try:
                    excluded = json.loads(p("exclude"))
                    if not isinstance(excluded, list) or len(excluded) > 100 or any(not isinstance(value, str) or len(value) > 200 for value in excluded):
                        raise ValueError()
                except (ValueError, TypeError):
                    return self.send_json({"success": False, "error": "exclude must be a JSON array of up to 100 song IDs"}, 400)
                results = get_song_suggestions(*args, excluded)
            else:
                results = get_song_suggestions(*args)
            return self.send_json({"success": True, "data": {"results": results}})

        if path.startswith("/api/songs/") and path.endswith("/lyrics"):
            song_id = path.split("/api/songs/")[1].replace("/lyrics","")
            try:
                jio = jiosaavn_call("lyrics.getLyrics", {"lyrics_id": song_id})
                if jio and jio.get("lyrics"):
                    return self.send_json({"success": True, "data": {"lyrics": jio["lyrics"]}})
            except Exception:
                pass
            return self.send_json({"success": True, "data": {"lyrics": None}})

        # ── External Lyrics (lyrics.ovh) ──────────────────────────────────────
        if path == "/api/lyrics/external":
            artist = p("artist")
            title = p("title")
            if not artist or not title:
                return self.send_json({"success": False})
            try:
                url = f"https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}/{urllib.parse.quote(title)}"
                data = fetch_json(url, timeout=6)
                if data and data.get("lyrics"):
                    return self.send_json({"success": True, "data": {"lyrics": data["lyrics"]}})
            except Exception:
                pass
            return self.send_json({"success": False})

        # ── Song Details ──────────────────────────────────────────────────────
        if path.startswith("/api/songs/"):
            song_id = path.split("/api/songs/")[1]
            if "/" not in song_id:
                try:
                    if song_id.startswith("itunes-") and song_id[7:].isdigit():
                        payload = fetch_json("https://itunes.apple.com/lookup?id=" + song_id[7:])
                        for item in (payload or {}).get("results", []):
                            song = format_itunes_track(item)
                            if song:
                                return self.send_json({"success": True, "data": song})
                        return self.send_json({"success": False, "error": "Song not found"}, 404)
                    if song_id.startswith("deezer-") and song_id[7:].isdigit():
                        song = format_deezer_track(fetch_json("https://api.deezer.com/track/" + song_id[7:]))
                        if song:
                            return self.send_json({"success": True, "data": song})
                        return self.send_json({"success": False, "error": "Song not found"}, 404)
                    if song_id.startswith("audius-"):
                        payload = fetch_json("https://discoveryprovider.audius.co/v1/tracks/" + urllib.parse.quote(song_id[7:], safe="") + "?app_name=BitGroove")
                        song = format_audius_track((payload or {}).get("data"))
                        if song:
                            return self.send_json({"success": True, "data": song})
                        return self.send_json({"success": False, "error": "Song not found"}, 404)
                    jio = jiosaavn_call("song.getDetails", {"pids": song_id})
                    # New format: {"songs": [...]} | Old format: {song_id: {...}} | list
                    raw = None
                    if isinstance(jio, dict):
                        if "songs" in jio and isinstance(jio["songs"], list) and jio["songs"]:
                            raw = jio["songs"][0]
                        elif song_id in jio:
                            raw = jio[song_id]
                    elif isinstance(jio, list) and jio:
                        raw = jio[0]
                    if raw:
                        return self.send_json({"success": True, "data": format_jiosaavn_song(raw)})
                except Exception:
                    pass
                return self.send_json({"success": False, "error": "Not found"}, status=404)

        # ── Homepage Modules (JioSaavn trending + albums + charts) ────────────
        if path == "/api/modules":
            return self.send_json({"success": True, "data": get_modules(p("languages") or p("language") or "hindi,english")})

        if path in ("/api/albums", "/api/playlists"):
            collection_id = p("id")
            if not collection_id:
                return self.send_json({"success": False, "error": "Collection ID required"}, 400)
            try:
                collection = get_collection_details(collection_id, "album" if path == "/api/albums" else "playlist")
            except Exception:
                collection = None
            return self.send_json({"success": True, "data": collection}) if collection else self.send_json({"success": False, "error": "Collection is unavailable"}, 404)

        # ── Static files / SPA fallback ───────────────────────────────────────
        file_path = os.path.join(PUBLIC_DIR, path.lstrip("/"))
        if path.startswith("/api/"):
            return self.send_json({"success": False, "error": "API endpoint not found"}, 404)
        if not os.path.exists(file_path) and not os.path.isdir(file_path):
            self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    print("\n" + "=" * 55)
    print("  🎵  BitGroove Music Player  –  Python Server")
    print("=" * 55)
    print(f"  Local URL : http://localhost:{PORT}")
    if HOST == "0.0.0.0":
        print(f"  LAN URL   : http://<this computer's IPv4 address>:{PORT}")
    print(f"  Sources   : JioSaavn (320kbps DES) | YouTube (InnerTube) | iTunes | Audius")
    print("=" * 55)
    print("  Press Ctrl+C to stop\n")
    try:
        with socketserver.ThreadingTCPServer((HOST, PORT), BitGrooveHandler) as httpd:
            httpd.daemon_threads = True
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as e:
        if "10048" in str(e) or "Address already in use" in str(e):
            print(f"\n⚠️  Port {PORT} is already in use. Stop any existing server first.")
        else:
            raise
