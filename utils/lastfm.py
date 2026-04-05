import requests
import os
from dotenv import load_dotenv

load_dotenv()

LASTFM_BASE = 'http://ws.audioscrobbler.com/2.0/'

class LastfmClient:
    def __init__(self):
        self.api_key = os.getenv('LASTFM_API_KEY')
        if not self.api_key:
            print("Warning: LASTFM_API_KEY not found. Last.fm features will not work.")

    def _call(self, method, **params):
        if not self.api_key:
            return None
        params.update({
            'method': method,
            'api_key': self.api_key,
            'format': 'json',
            'autocorrect': 1
        })
        try:
            resp = requests.get(LASTFM_BASE, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if 'error' in data:
                print(f"Last.fm API error: {data.get('message')}")
                return None
            return data
        except Exception as e:
            print(f"Last.fm request failed: {e}")
            return None

    def search_tracks(self, query, limit=20):
        data = self._call('track.search', track=query, limit=limit)
        if not data:
            return []

        try:
            matches = data['results']['trackmatches']['track']
        except (KeyError, TypeError):
            return []

        tracks = []
        for item in matches:
            info = self.get_track_info(item.get('artist', ''), item.get('name', ''))
            image = None
            if info and info.get('image'):
                image = info['image']
            tags = info.get('tags', []) if info else []

            tracks.append({
                'id': item.get('mbid', ''),
                'name': item.get('name', ''),
                'artist': item.get('artist', ''),
                'album': info.get('album', '') if info else '',
                'image': image,
                'preview_url': None,
                'external_url': item.get('url', ''),
                'genres': tags[:3],
                'release_date': '',
                'duration_ms': int(info.get('duration', 0)) if info else 0,
                'popularity': 0,
                'explicit': False,
                'listeners': int(item.get('listeners', 0)),
                'playcount': int(info.get('playcount', 0)) if info else 0,
                'source': 'lastfm'
            })

        return tracks

    def get_track_info(self, artist, track):
        data = self._call('track.getInfo', artist=artist, track=track)
        if not data or 'track' not in data:
            return None

        t = data['track']
        images = t.get('album', {}).get('image', [])
        image_url = None
        for img in reversed(images):
            if img.get('#text'):
                image_url = img['#text']
                break

        tag_list = []
        top_tags = t.get('toptags', {}).get('tag', [])
        if isinstance(top_tags, list):
            tag_list = [tag['name'] for tag in top_tags if tag.get('name')]
        elif isinstance(top_tags, dict) and top_tags.get('name'):
            tag_list = [top_tags['name']]

        return {
            'listeners': int(t.get('listeners', 0)),
            'playcount': int(t.get('playcount', 0)),
            'duration': int(t.get('duration', 0)),
            'tags': tag_list[:5],
            'url': t.get('url', ''),
            'album': t.get('album', {}).get('title', ''),
            'image': image_url
        }

    def get_similar_tracks(self, artist, track, limit=10):
        data = self._call('track.getSimilar', artist=artist, track=track, limit=limit)
        if not data or 'similartracks' not in data:
            return []

        similar = data['similartracks'].get('track', [])
        results = []
        for item in similar:
            images = item.get('image', [])
            image_url = None
            for img in reversed(images):
                if img.get('#text'):
                    image_url = img['#text']
                    break

            results.append({
                'name': item.get('name', ''),
                'artist': item.get('artist', {}).get('name', ''),
                'match': round(float(item.get('match', 0)) * 100),
                'url': item.get('url', ''),
                'image': image_url,
                'playcount': int(item.get('playcount', 0))
            })

        return results
