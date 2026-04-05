import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import os
from dotenv import load_dotenv

load_dotenv()

class SpotifyClient:
    def __init__(self):
        client_id = os.getenv('SPOTIPY_CLIENT_ID')
        client_secret = os.getenv('SPOTIPY_CLIENT_SECRET')
        
        if not client_id or not client_secret:
            self.sp = None
            print("Warning: Spotify credentials not found. Search will not work.")
        else:
            auth_manager = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
            self.sp = spotipy.Spotify(auth_manager=auth_manager)

    def search_tracks(self, query, limit=20, search_type='track'):
        """
        Searches for tracks and enriches them with genre data.
        If search_type is 'genre', constructs a genre specific query.
        """
        if not self.sp:
            return []
        
        try:
            # Construct query based on type
            q = query
            if search_type == 'genre':
                q = f'genre:"{query}"'
            
            results = self.sp.search(q=q, limit=limit, type='track')
            
            if not results['tracks']['items']:
                return []

            tracks_data = results['tracks']['items']
            
            # Extract unique Artist IDs to fetch genres (Spotify tracks don't have genres, Artists do)
            artist_ids = set()
            for item in tracks_data:
                for artist in item['artists']:
                    artist_ids.add(artist['id'])
            
            # Batch fetch artists to get genres
            artist_genres = {}
            if artist_ids:
                artists_info = self.sp.artists(list(artist_ids))
                for artist in artists_info['artists']:
                    artist_genres[artist['id']] = artist['genres']

            processed_tracks = []
            for item in tracks_data:
                # Get primary artist's ID
                primary_artist_id = item['artists'][0]['id']
                # Get genres for the primary artist
                genres = artist_genres.get(primary_artist_id, [])
                
                track = {
                    'id': item['id'],
                    'name': item['name'],
                    'artist': item['artists'][0]['name'],
                    'album': item['album']['name'],
                    'image': item['album']['images'][0]['url'] if item['album']['images'] else None,
                    'preview_url': item['preview_url'], # Note: May be None as Spotify deprecated this for many tracks
                    'external_url': item['external_urls']['spotify'],
                    'genres': genres[:3] # Limit to top 3 genres
                }
                processed_tracks.append(track)
                
            return processed_tracks
        except spotipy.exceptions.SpotifyException as e:
            print(f"Error searching Spotify: {e}")
            if e.http_status == 403:
                 return {'error': 'Vyhledávání přes Spotify je aktuálně mimo provoz (Developer účet vyžaduje Premium). Prosím použijte Last.fm nebo Soundcharts.'}
            return {'error': str(e)}
        except Exception as e:
            print(f"Error searching Spotify: {e}")
            return []
