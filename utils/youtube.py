import os
from ytmusicapi import YTMusic

class YoutubeClient:
    def __init__(self):
        cookie_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cookie.txt')
        if os.path.exists(cookie_path):
            self.yt = YTMusic(cookie_path)
        else:
            self.yt = YTMusic()

    def search_tracks(self, query, limit=20, search_type='track'):
        """
        Searches for tracks on YouTube Music.
        """
        try:
            filter_param = 'songs'
            if search_type == 'genre':
                filter_param = 'songs' # We can just search songs for genre text
                
            results = self.yt.search(query, filter=filter_param, limit=limit)
            
            processed_tracks = []
            for item in results:
                if item['resultType'] != 'song' and item['resultType'] != 'video':
                    continue
                
                # ytmusicapi gives lists of artists, usually we just want the first one
                artist_name = "Unknown Artist"
                if 'artists' in item and item['artists']:
                    artist_name = item['artists'][0]['name']
                    
                album_name = ""
                if 'album' in item and item['album'] and 'name' in item['album']:
                    album_name = item['album']['name']
                    
                image_url = None
                if 'thumbnails' in item and item['thumbnails']:
                    # Get the largest thumbnail
                    image_url = item['thumbnails'][-1]['url']
                
                track_id = item.get('videoId', '')
                if not track_id:
                    continue
                
                duration_ms = 0
                if 'duration_seconds' in item and item['duration_seconds']:
                    duration_ms = int(item['duration_seconds']) * 1000
                elif 'duration' in item and item['duration']:
                    # 'MM:SS' or 'HH:MM:SS'
                    parts = item['duration'].split(':')
                    if len(parts) == 2:
                        duration_ms = (int(parts[0]) * 60 + int(parts[1])) * 1000
                    elif len(parts) == 3:
                        duration_ms = (int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])) * 1000
                
                track = {
                    'id': track_id,
                    'name': item['title'],
                    'artist': artist_name,
                    'album': album_name,
                    'image': image_url,
                    'preview_url': None,
                    'external_url': f"https://music.youtube.com/watch?v={track_id}",
                    'genres': [], # YouTube doesn't expose genres in standard search
                    'duration_ms': duration_ms,
                    'source': 'youtube'
                }
                processed_tracks.append(track)
                
                if len(processed_tracks) >= limit:
                    break
                    
            return processed_tracks
        except Exception as e:
            print(f"Error searching YouTube Music: {e}")
            return {'error': str(e)}
