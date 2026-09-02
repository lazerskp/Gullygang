"""
services/ytmusic/provider.py
GULLYGANG — YouTube Music Provider Service (Step 15)
Interacts with ytmusicapi to search songs, artists, albums, videos,
fetch full artist profiles, and load complete album tracklists.
"""

import sys
import re
import json
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional

try:
    from ytmusicapi import YTMusic
    _HAS_YTMUSICAPI = True
except ImportError:
    _HAS_YTMUSICAPI = False


class YTMusicProvider:
    def __init__(self):
        self.yt = None
        if _HAS_YTMUSICAPI:
            try:
                self.yt = YTMusic()
            except Exception as e:
                print(f"[YTMusicProvider] Init notice: {e}", file=sys.stderr)

    @staticmethod
    def _parse_duration_seconds(duration_str: Optional[str]) -> int:
        if not duration_str or not isinstance(duration_str, str):
            return 0
        parts = duration_str.strip().split(':')
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except (ValueError, TypeError):
            pass
        return 0

    @staticmethod
    def _extract_best_thumbnail(thumbnails: Any, default_id: Optional[str] = None) -> str:
        if isinstance(thumbnails, list) and len(thumbnails) > 0:
            sorted_thumbs = sorted(thumbnails, key=lambda t: t.get('width', 0) if isinstance(t, dict) else 0, reverse=True)
            url = sorted_thumbs[0].get('url', '') if isinstance(sorted_thumbs[0], dict) else ''
            if url:
                url = re.sub(r'=w\d+-h\d+', '=w544-h544', url)
                return url
        elif isinstance(thumbnails, str) and thumbnails.strip():
            return thumbnails.strip()
        if default_id:
            return f"https://i.ytimg.com/vi/{default_id}/hqdefault.jpg"
        return "https://gullygang.in/brand-cover.png"

    def normalize_track(self, item: Dict[str, Any], fallback_artist: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        video_id = item.get('videoId') or item.get('id')
        if not video_id:
            return None

        title = item.get('title') or 'Untitled'
        
        # Parse artists
        artists_raw = item.get('artists') or []
        artists_list = []
        if isinstance(artists_raw, list):
            for a in artists_raw:
                if isinstance(a, dict) and a.get('name'):
                    artists_list.append({
                        "id": a.get('id') or a.get('browseId') or "",
                        "name": a.get('name').strip()
                    })
                elif isinstance(a, str) and a.strip():
                    artists_list.append({"id": "", "name": a.strip()})
        elif isinstance(artists_raw, str) and artists_raw.strip():
            artists_list = [{"id": "", "name": artists_raw.strip()}]
        
        if not artists_list and fallback_artist:
            artists_list = [{"id": "", "name": fallback_artist.strip()}]
        elif not artists_list and item.get('author'):
            artists_list = [{"id": "", "name": str(item.get('author')).strip()}]
        elif not artists_list:
            artists_list = [{"id": "", "name": "GULLYGANG"}]

        artist_str = ", ".join([a["name"] for a in artists_list])

        # Parse album
        album_raw = item.get('album')
        album_name = ""
        album_id = ""
        if isinstance(album_raw, dict):
            album_name = album_raw.get('name') or ""
            album_id = album_raw.get('id') or album_raw.get('browseId') or ""
        elif isinstance(album_raw, str):
            album_name = album_raw

        # Duration
        duration_str = item.get('duration') or "0:00"
        duration_seconds = item.get('duration_seconds') or self._parse_duration_seconds(duration_str)

        # Thumbnail
        thumbnails = item.get('thumbnails') or []
        thumbnail_url = self._extract_best_thumbnail(thumbnails, video_id)

        result_type = item.get('resultType') or item.get('type') or 'song'
        if result_type == 'video' or item.get('videoType'):
            result_type = 'video'

        track_num = item.get('trackNumber') or 1

        return {
            "id": video_id,
            "videoId": video_id,
            "title": title,
            "artist": artist_str,
            "artists": artists_list,
            "album": album_name,
            "albumId": album_id,
            "duration": duration_str,
            "duration_seconds": duration_seconds,
            "thumbnail": thumbnail_url,
            "trackNumber": track_num,
            "resultType": result_type,
            "source": "ytmusic"
        }

    def normalize_artist(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        artist_id = item.get('browseId') or item.get('id') or item.get('channelId')
        if not artist_id:
            return None

        name = (item.get('artist') or item.get('name') or item.get('title') or 'Unknown Artist').strip()
        thumbnails = item.get('thumbnails') or []
        thumbnail_url = self._extract_best_thumbnail(thumbnails)
        subscribers = item.get('subscribers') or item.get('views') or ''
        description = item.get('description') or ''

        return {
            "id": artist_id,
            "name": name,
            "thumbnail": thumbnail_url,
            "description": description,
            "subscribers": str(subscribers),
            "resultType": "artist",
            "source": "ytmusic"
        }

    def normalize_album(self, item: Dict[str, Any], fallback_artist: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        album_id = item.get('browseId') or item.get('id') or item.get('playlistId')
        if not album_id:
            return None

        title = (item.get('title') or item.get('name') or 'Untitled Album').strip()
        
        # Parse artists
        artists_raw = item.get('artists') or []
        artists_list = []
        if isinstance(artists_raw, list):
            for a in artists_raw:
                if isinstance(a, dict) and a.get('name'):
                    artists_list.append({"id": a.get('id') or "", "name": a.get('name').strip()})
                elif isinstance(a, str) and a.strip():
                    artists_list.append({"id": "", "name": a.strip()})
        elif isinstance(artists_raw, str) and artists_raw.strip():
            artists_list = [{"id": "", "name": artists_raw.strip()}]
        
        if not artists_list and fallback_artist:
            artists_list = [{"id": "", "name": fallback_artist.strip()}]
        elif not artists_list and item.get('artist'):
            artists_list = [{"id": "", "name": str(item.get('artist')).strip()}]
        elif not artists_list:
            artists_list = [{"id": "", "name": "GULLYGANG"}]

        artist_str = ", ".join([a["name"] for a in artists_list])
        
        # Year
        year_val = item.get('year') or (item.get('type') if str(item.get('type', '')).isdigit() else '') or ''
        year_str = str(year_val)

        thumbnails = item.get('thumbnails') or []
        thumbnail_url = self._extract_best_thumbnail(thumbnails)
        track_count = item.get('trackCount') or len(item.get('tracks') or [])

        return {
            "id": album_id,
            "title": title,
            "artist": artist_str,
            "artists": artists_list,
            "year": year_str,
            "thumbnail": thumbnail_url,
            "trackCount": track_count,
            "resultType": "album",
            "source": "ytmusic"
        }

    def normalize_item(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None
        res_type = (item.get('resultType') or item.get('type') or '').lower()
        if res_type == 'artist':
            return self.normalize_artist(item)
        elif res_type == 'album':
            return self.normalize_album(item)
        else:
            return self.normalize_track(item)

    def search(self, query: str, limit: int = 20, filter_type: Optional[str] = "all") -> Dict[str, Any]:
        query = (query or "").strip()
        if len(query) < 2:
            return {"top": [], "songs": [], "artists": [], "albums": [], "videos": []} if filter_type == "all" else []

        limit = max(1, min(30, int(limit)))
        norm_filter = (filter_type or "all").lower().strip()

        if not self.yt:
            return {"top": [], "songs": [], "artists": [], "albums": [], "videos": []} if norm_filter == "all" else []

        # Case 1: Specific category search
        if norm_filter in ["songs", "artists", "albums", "videos"]:
            try:
                raw_results = self.yt.search(query, filter=norm_filter, limit=limit)
                normalized = []
                for r in raw_results:
                    if norm_filter == "artists":
                        norm = self.normalize_artist(r)
                    elif norm_filter == "albums":
                        norm = self.normalize_album(r)
                    else:
                        norm = self.normalize_track(r)
                    if norm:
                        normalized.append(norm)
                        if len(normalized) >= limit:
                            break
                return normalized
            except Exception as err:
                print(f"[YTMusicProvider] filter search notice ({norm_filter}): {err}", file=sys.stderr)
                return []

        # Case 2: Grouped 'all' search
        def fetch_category(cat: str, cat_limit: int):
            try:
                raw = self.yt.search(query, filter=cat, limit=cat_limit)
                res = []
                for item in raw:
                    if cat == "artists":
                        n = self.normalize_artist(item)
                    elif cat == "albums":
                        n = self.normalize_album(item)
                    else:
                        n = self.normalize_track(item)
                    if n:
                        res.append(n)
                        if len(res) >= cat_limit:
                            break
                return res
            except Exception as e:
                print(f"[YTMusicProvider] parallel search ({cat}) notice: {e}", file=sys.stderr)
                return []

        grouped: Dict[str, List[Dict[str, Any]]] = {
            "top": [],
            "songs": [],
            "artists": [],
            "albums": [],
            "videos": []
        }

        with ThreadPoolExecutor(max_workers=4) as executor:
            fut_songs = executor.submit(fetch_category, "songs", min(limit, 10))
            fut_artists = executor.submit(fetch_category, "artists", 4)
            fut_albums = executor.submit(fetch_category, "albums", 6)
            fut_videos = executor.submit(fetch_category, "videos", 4)

            grouped["songs"] = fut_songs.result()
            grouped["artists"] = fut_artists.result()
            grouped["albums"] = fut_albums.result()
            grouped["videos"] = fut_videos.result()

        # Compute Top Result
        top_result = None
        clean_q = query.lower()
        for art in grouped["artists"]:
            if art["name"].lower() == clean_q or clean_q in art["name"].lower():
                top_result = art
                break

        if not top_result and grouped["songs"]:
            top_result = grouped["songs"][0]
        elif not top_result and grouped["artists"]:
            top_result = grouped["artists"][0]
        elif not top_result and grouped["albums"]:
            top_result = grouped["albums"][0]
        elif not top_result and grouped["videos"]:
            top_result = grouped["videos"][0]

        if top_result:
            grouped["top"] = [top_result]

        return grouped

    def get_artist(self, artist_id: str) -> Optional[Dict[str, Any]]:
        artist_id = (artist_id or "").strip()
        if not artist_id or len(artist_id) < 5:
            return None

        if not self.yt:
            return None

        try:
            data = self.yt.get_artist(artist_id)
            if not isinstance(data, dict):
                return None

            name = (data.get('name') or 'Unknown Artist').strip()
            description = data.get('description') or ''
            subscribers = data.get('subscribers') or ''
            thumbnails = data.get('thumbnails') or []
            thumbnail_url = self._extract_best_thumbnail(thumbnails)

            artist_obj = {
                "id": artist_id,
                "name": name,
                "thumbnail": thumbnail_url,
                "description": description,
                "subscribers": str(subscribers),
                "resultType": "artist",
                "source": "ytmusic"
            }

            # Top songs
            top_songs = []
            raw_songs = data.get('songs', {}).get('results', [])
            for s in raw_songs:
                norm_song = self.normalize_track(s, fallback_artist=name)
                if norm_song:
                    top_songs.append(norm_song)

            # Albums
            albums = []
            raw_albums = data.get('albums', {}).get('results', [])
            for alb in raw_albums:
                norm_alb = self.normalize_album(alb, fallback_artist=name)
                if norm_alb:
                    albums.append(norm_alb)

            # Singles
            singles = []
            raw_singles = data.get('singles', {}).get('results', [])
            for s in raw_singles:
                norm_s = self.normalize_album(s, fallback_artist=name)
                if norm_s:
                    singles.append(norm_s)

            # Related Artists
            related = []
            raw_related = data.get('related', {}).get('results', [])
            for r in raw_related:
                norm_r = self.normalize_artist(r)
                if norm_r:
                    related.append(norm_r)

            return {
                "artist": artist_obj,
                "topSongs": top_songs,
                "albums": albums,
                "singles": singles,
                "relatedArtists": related
            }
        except Exception as err:
            print(f"[YTMusicProvider] get_artist error ({artist_id}): {err}", file=sys.stderr)
            return None

    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        album_id = (album_id or "").strip()
        if not album_id or len(album_id) < 5:
            return None

        if not self.yt:
            return None

        try:
            data = self.yt.get_album(album_id)
            if not isinstance(data, dict):
                return None

            title = (data.get('title') or 'Untitled Album').strip()
            description = data.get('description') or ''
            year = str(data.get('year') or '')
            duration = str(data.get('duration') or '')
            thumbnails = data.get('thumbnails') or []
            thumbnail_url = self._extract_best_thumbnail(thumbnails)

            # Parse artists
            artists_raw = data.get('artists') or []
            artists_list = []
            if isinstance(artists_raw, list):
                for a in artists_raw:
                    if isinstance(a, dict) and a.get('name'):
                        artists_list.append({"id": a.get('id') or "", "name": a.get('name').strip()})
                    elif isinstance(a, str) and a.strip():
                        artists_list.append({"id": "", "name": a.strip()})
            elif isinstance(artists_raw, str) and artists_raw.strip():
                artists_list = [{"id": "", "name": artists_raw.strip()}]

            artist_str = ", ".join([a["name"] for a in artists_list]) if artists_list else "GULLYGANG"

            # Parse tracks
            raw_tracks = data.get('tracks') or []
            tracks = []
            for idx, t in enumerate(raw_tracks):
                vid = t.get('videoId')
                if not vid:
                    continue
                t_thumb = self._extract_best_thumbnail(t.get('thumbnails'), vid)
                if not t_thumb or 'brand-cover' in t_thumb or 'placeholder' in t_thumb:
                    t_thumb = thumbnail_url

                t_dur = t.get('duration') or '0:00'
                t_dur_secs = t.get('duration_seconds') or self._parse_duration_seconds(t_dur)

                # Track artists
                t_artists = t.get('artists') or artists_list
                t_artists_list = []
                if isinstance(t_artists, list):
                    for a in t_artists:
                        if isinstance(a, dict) and a.get('name'):
                            t_artists_list.append({"id": a.get('id') or "", "name": a.get('name').strip()})
                        elif isinstance(a, str) and a.strip():
                            t_artists_list.append({"id": "", "name": a.strip()})
                if not t_artists_list:
                    t_artists_list = artists_list

                tracks.append({
                    "id": vid,
                    "videoId": vid,
                    "title": t.get('title') or f"Track {idx + 1}",
                    "artist": ", ".join([a["name"] for a in t_artists_list]),
                    "artists": t_artists_list,
                    "album": title,
                    "albumId": album_id,
                    "trackNumber": t.get('trackNumber') or (idx + 1),
                    "duration": t_dur,
                    "duration_seconds": t_dur_secs,
                    "thumbnail": t_thumb,
                    "resultType": "song",
                    "source": "ytmusic"
                })

            album_obj = {
                "id": album_id,
                "title": title,
                "artist": artist_str,
                "artists": artists_list,
                "year": year,
                "duration": duration,
                "thumbnail": thumbnail_url,
                "description": description,
                "trackCount": len(tracks),
                "resultType": "album",
                "source": "ytmusic"
            }

            return {
                "album": album_obj,
                "tracks": tracks
            }
        except Exception as err:
            print(f"[YTMusicProvider] get_album error ({album_id}): {err}", file=sys.stderr)
            return None

    def get_suggestions(self, query: str, limit: int = 10) -> List[str]:
        query = (query or "").strip()
        if len(query) < 2:
            return []

        limit = max(1, min(10, int(limit)))

        if self.yt:
            try:
                sugs = self.yt.get_search_suggestions(query)
                if isinstance(sugs, list):
                    return [str(s).strip() for s in sugs if str(s).strip()][:limit]
            except Exception as err:
                print(f"[YTMusicProvider] suggestions error: {err}", file=sys.stderr)

        # Fallback: Google / YouTube suggestion endpoint
        try:
            url = f"https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q={urllib.parse.quote(query)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                text = resp.read().decode('utf-8', errors='ignore')
                match = re.search(r'\[\s*"[^"]+"\s*,\s*(\[.*?\])\s*\]', text)
                if match:
                    items = json.loads(match.group(1))
                    return [i[0] for i in items if isinstance(i, list) and len(i) > 0][:limit]
        except Exception:
            pass

        return []

    def get_related(self, video_id: str, limit: int = 15) -> List[Dict[str, Any]]:
        video_id = (video_id or "").strip()
        if not video_id or not re.match(r'^[a-zA-Z0-9_-]{8,16}$', video_id):
            return []

        limit = max(1, min(30, int(limit)))
        results: List[Dict[str, Any]] = []

        if self.yt:
            try:
                song = self.yt.get_song(video_id)
                details = song.get('videoDetails', {}) if isinstance(song, dict) else {}
                title = details.get('title') or ''
                artist = details.get('author') or ''
                search_query = f"{title} {artist}".strip()
                if search_query:
                    search_results = self.yt.search(search_query, filter='songs', limit=limit + 3)
                    for r in search_results:
                        norm = self.normalize_track(r)
                        if norm and norm['videoId'] != video_id:
                            results.append(norm)
                            if len(results) >= limit:
                                break
            except Exception as err:
                print(f"[YTMusicProvider] get_related notice: {err}", file=sys.stderr)

        return results[:limit]
