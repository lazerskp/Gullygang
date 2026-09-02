#!/usr/bin/env python3
"""
services/ytmusic/app.py
GULLYGANG — YouTube Music CLI and Subprocess Bridge (Step 15)
Accepts CLI arguments or JSON stdin, queries YTMusicProvider, and outputs clean JSON.
"""

import sys
import json
from provider import YTMusicProvider


def main():
    provider = YTMusicProvider()

    # Mode 1: CLI positional arguments
    if len(sys.argv) > 1:
        action = sys.argv[1].lower().strip()
        if action == "search":
            query = sys.argv[2] if len(sys.argv) > 2 else ""
            limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 20
            filter_type = sys.argv[4] if len(sys.argv) > 4 else "all"
            results = provider.search(query, limit=limit, filter_type=filter_type)
            print(json.dumps({"success": True, "query": query, "type": filter_type, "results": results}))
            return

        elif action == "artist":
            artist_id = sys.argv[2] if len(sys.argv) > 2 else ""
            data = provider.get_artist(artist_id)
            if data:
                print(json.dumps({"success": True, **data}))
            else:
                print(json.dumps({"success": False, "error": f"Artist not found: {artist_id}"}))
            return

        elif action == "album":
            album_id = sys.argv[2] if len(sys.argv) > 2 else ""
            data = provider.get_album(album_id)
            if data:
                print(json.dumps({"success": True, **data}))
            else:
                print(json.dumps({"success": False, "error": f"Album not found: {album_id}"}))
            return

        elif action == "suggestions":
            query = sys.argv[2] if len(sys.argv) > 2 else ""
            limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 10
            sugs = provider.get_suggestions(query, limit=limit)
            print(json.dumps({"success": True, "query": query, "suggestions": sugs}))
            return

        elif action == "related":
            video_id = sys.argv[2] if len(sys.argv) > 2 else ""
            limit = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 15
            results = provider.get_related(video_id, limit=limit)
            print(json.dumps({"success": True, "videoId": video_id, "results": results}))
            return

    # Mode 2: JSON from stdin
    try:
        raw_input = sys.stdin.read().strip()
        if raw_input:
            payload = json.loads(raw_input)
            action = payload.get("action", "search").lower().strip()

            if action == "search":
                query = payload.get("query") or payload.get("q") or ""
                limit = int(payload.get("limit", 20))
                filter_type = payload.get("type") or payload.get("filter") or "all"
                results = provider.search(query, limit=limit, filter_type=filter_type)
                print(json.dumps({"success": True, "query": query, "type": filter_type, "results": results}))

            elif action == "artist":
                artist_id = payload.get("id") or payload.get("artistId") or ""
                data = provider.get_artist(artist_id)
                if data:
                    print(json.dumps({"success": True, **data}))
                else:
                    print(json.dumps({"success": False, "error": f"Artist not found: {artist_id}"}))

            elif action == "album":
                album_id = payload.get("id") or payload.get("albumId") or ""
                data = provider.get_album(album_id)
                if data:
                    print(json.dumps({"success": True, **data}))
                else:
                    print(json.dumps({"success": False, "error": f"Album not found: {album_id}"}))

            elif action == "suggestions":
                query = payload.get("query") or payload.get("q") or ""
                limit = int(payload.get("limit", 10))
                sugs = provider.get_suggestions(query, limit=limit)
                print(json.dumps({"success": True, "query": query, "suggestions": sugs}))

            elif action == "related":
                video_id = payload.get("videoId") or payload.get("id") or ""
                limit = int(payload.get("limit", 15))
                results = provider.get_related(video_id, limit=limit)
                print(json.dumps({"success": True, "videoId": video_id, "results": results}))

            else:
                print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
            return
    except Exception as err:
        print(json.dumps({"success": False, "error": str(err)}))
        return

    print(json.dumps({"success": False, "error": "No action specified"}))


if __name__ == "__main__":
    main()
