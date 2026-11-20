"""Optional live provider/proxy smoke check; no audio is saved to disk."""
import json
import pathlib
import socketserver
import sys
import threading
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import server


with socketserver.ThreadingTCPServer(("127.0.0.1", 0), server.BitGrooveHandler) as httpd:
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = "http://127.0.0.1:" + str(httpd.server_address[1])
    try:
        for query in ("Arijit Singh", "Taylor Swift"):
            started = time.monotonic()
            with urllib.request.urlopen(base + "/api/search/songs?" + urllib.parse.urlencode({"query": query, "limit": 3}), timeout=15) as response:
                result = json.load(response)["data"]["results"]
            print(json.dumps({"query": query, "seconds": round(time.monotonic() - started, 3),
                              "results": len(result), "sources": sorted(set(song["source"] for song in result)),
                              "first": result[0]["name"] if result else None}))
            if not result:
                raise RuntimeError("Live search returned no playable results")
            song = result[0]
            media = next((entry["link"] for entry in song["downloadUrl"] if entry["quality"] == "160kbps"), song["downloadUrl"][0]["link"])
            request = urllib.request.Request(base + "/api/stream?" + urllib.parse.urlencode({"url": media}), headers={"Range": "bytes=0-1023"})
            with urllib.request.urlopen(request, timeout=12) as response:
                print(json.dumps({"source": song["source"], "streamStatus": response.status,
                                  "contentType": response.headers.get("Content-Type"),
                                  "contentRange": response.headers.get("Content-Range"),
                                  "bytes": len(response.read(1024))}))
    finally:
        httpd.shutdown()
        thread.join()
