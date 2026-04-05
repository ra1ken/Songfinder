import requests
import os
from dotenv import load_dotenv

load_dotenv()

SOUNDCHARTS_BASE = 'https://customer.api.soundcharts.com'

class SoundchartsClient:
    def __init__(self):
        self.app_id = os.getenv('SOUNDCHARTS_APP_ID')
        self.api_key = os.getenv('SOUNDCHARTS_API_KEY')
        if not self.app_id or not self.api_key:
            print("Warning: Soundcharts credentials not found.")

    def _headers(self):
        return {
            'x-app-id': self.app_id,
            'x-api-key': self.api_key
        }

    def _get(self, path, params=None):
        if not self.app_id or not self.api_key:
            return None
        try:
            resp = requests.get(
                f"{SOUNDCHARTS_BASE}{path}",
                headers=self._headers(),
                params=params,
                timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get('errors') and len(data['errors']) > 0 and data['errors'][0].get('code', 0) >= 400:
                print(f"Soundcharts error: {data['errors']}")
                return None
            return data
        except Exception as e:
            print(f"Soundcharts request failed: {e}")
            return None

    def search_tracks(self, query, limit=20):
        data = self._get(f'/api/v2/song/search/{requests.utils.quote(query)}', {'limit': limit})
        if not data or 'items' not in data:
            return []

        tracks = []
        for item in data['items']:
            detail = self.get_song_detail(item.get('uuid', ''))
            genres = []
            explicit = False
            duration_ms = 0
            audio = {}

            if detail:
                for g in detail.get('genres', []):
                    genres.append(g.get('root', ''))
                    for s in g.get('sub', []):
                        if s != g.get('root', ''):
                            genres.append(s)
                genres = list(dict.fromkeys(genres))[:3]
                explicit = detail.get('explicit', False)
                duration_ms = detail.get('duration', 0) * 1000
                audio = detail.get('audio', {})

            release = item.get('releaseDate', '')
            if release:
                release = release[:10]

            tracks.append({
                'id': item.get('uuid', ''),
                'name': item.get('name', ''),
                'artist': item.get('creditName', ''),
                'album': '',
                'image': item.get('imageUrl', None),
                'preview_url': None,
                'external_url': detail.get('appUrl', '') if detail else '',
                'genres': genres,
                'release_date': release,
                'duration_ms': duration_ms,
                'popularity': 0,
                'explicit': explicit,
                'listeners': 0,
                'playcount': 0,
                'source': 'soundcharts',
                'audio_features': {
                    'energy': round(audio.get('energy', 0) * 100),
                    'danceability': round(audio.get('danceability', 0) * 100),
                    'valence': round(audio.get('valence', 0) * 100),
                    'bpm': audio.get('tempo', 0)
                } if audio else None
            })

        return tracks

    def get_song_detail(self, uuid):
        if not uuid:
            return None
        data = self._get(f'/api/v2.25/song/{uuid}')
        if not data or 'object' not in data:
            return None
        return data['object']
