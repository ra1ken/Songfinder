from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session
import os
from dotenv import load_dotenv
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from models import db, User, PlaylistItem
import json
import requests as http_requests
from werkzeug.security import generate_password_hash, check_password_hash
from utils.spotify import SpotifyClient
from utils.lastfm import LastfmClient
from utils.soundcharts import SoundchartsClient
from urllib.parse import urlencode
import ssl

try:
    with open(os.path.join(os.path.dirname(__file__), 'utils', 'translations.json'), 'r', encoding='utf-8') as f:
        TRANSLATIONS = json.load(f)
except Exception:
    TRANSLATIONS = {}

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev_key')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///songfinder.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

SPOTIFY_CLIENT_ID = os.getenv('SPOTIPY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIPY_CLIENT_SECRET')
SPOTIFY_REDIRECT_URI = 'https://127.0.0.1:5000/spotify/callback'

db.init_app(app)
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.init_app(app)
spotify_client = SpotifyClient()
lastfm_client = LastfmClient()
soundcharts_client = SoundchartsClient()

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.context_processor
def inject_translations():
    lang = 'cs'
    if current_user.is_authenticated and current_user.language:
        lang = current_user.language
    elif 'guest_settings' in session and 'language' in session['guest_settings']:
        lang = session['guest_settings']['language']
    
    theme = 'off'
    if current_user.is_authenticated and current_user.dark_mode:
        theme = current_user.dark_mode
    elif 'guest_settings' in session and 'dark_mode' in session['guest_settings']:
        theme = session['guest_settings']['dark_mode']
        
    return dict(t=TRANSLATIONS.get(lang, TRANSLATIONS['cs']), active_theme=theme)

with app.app_context():
    db.create_all()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/playlist')
def playlist():
    items = []
    playlist_name = 'My Playlist'
    if current_user.is_authenticated:
        items = [item.to_dict() for item in current_user.playlist_items]
        playlist_name = current_user.playlist_name
    return render_template('playlist.html', playlist_items=items, playlist_name=playlist_name)

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/settings')
def settings():
    if current_user.is_authenticated:
        user_settings = current_user
    else:
        class GuestSettings:
            def __init__(self):
                guest = session.get('guest_settings', {})
                self.dark_mode = guest.get('dark_mode', 'off')
                self.language = guest.get('language', 'cs')
        user_settings = GuestSettings()
        
    return render_template('settings.html', user_settings=user_settings)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        
        if user and check_password_hash(user.password_hash, password):
            login_user(user)
            return redirect(url_for('index'))
        else:
            flash('Invalid username or password')
            
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if User.query.filter_by(username=username).first():
            flash('Username already exists')
            return redirect(url_for('register'))
            
        new_user = User(
            username=username,
            password_hash=generate_password_hash(password)
        )
        
        db.session.add(new_user)
        db.session.commit()
        
        login_user(new_user)
        return redirect(url_for('index'))
        
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/api/search')
def search():
    query = request.args.get('q', '')
    limit = request.args.get('limit', 20, type=int)
    source = request.args.get('source', 'spotify')
    
    if not query:
        return jsonify([])
    
    if source == 'lastfm':
        results = lastfm_client.search_tracks(query, limit=limit)
    elif source == 'soundcharts':
        results = soundcharts_client.search_tracks(query, limit=limit)
    else:
        genres = ['rock', 'pop', 'jazz', 'classical', 'metal', 'hip-hop', 'electronic']
        search_type = 'genre' if query.lower() in genres else 'track'
        results = spotify_client.search_tracks(query, limit=limit, search_type=search_type)
        if isinstance(results, dict) and 'error' in results:
            return jsonify(results), 403
        for track in results:
            track['source'] = 'spotify'
    
    return jsonify(results)

@app.route('/api/track/similar')
def similar_tracks():
    artist = request.args.get('artist', '')
    track = request.args.get('track', '')
    limit = request.args.get('limit', 8, type=int)
    
    if not artist or not track:
        return jsonify([])
    
    results = lastfm_client.get_similar_tracks(artist, track, limit=limit)
    return jsonify(results)

@app.route('/api/playlist', methods=['GET'])
@login_required
def get_playlist():
    items = [item.to_dict() for item in current_user.playlist_items]
    return jsonify(items)

@app.route('/api/playlist/add', methods=['POST'])
@login_required
def add_to_playlist():
    try:
        data = request.get_json()
        
        spotify_uri = ''
        if data.get('source') == 'spotify' and data.get('id'):
            spotify_uri = f"spotify:track:{data['id']}"
        
        # Get max list_order
        max_order = db.session.query(db.func.max(PlaylistItem.list_order))\
            .filter_by(user_id=current_user.id).scalar() or 0
        
        item = PlaylistItem(
            user_id=current_user.id,
            list_order=max_order + 1,
            track_name=data.get('name', ''),
            artist=data.get('artist', ''),
            album=data.get('album', ''),
            image=data.get('image', ''),
            external_url=data.get('external_url', ''),
            source=data.get('source', 'spotify'),
            spotify_uri=spotify_uri,
            duration_ms=data.get('duration_ms', 0)
        )
        
        db.session.add(item)
        db.session.commit()
        
        return jsonify({'success': True, 'item': item.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/rename', methods=['POST'])
@login_required
def rename_playlist():
    try:
        data = request.get_json()
        new_name = data.get('name', '').strip()
        if new_name:
            current_user.playlist_name = new_name
            db.session.commit()
            return jsonify({'success': True, 'name': new_name})
        return jsonify({'success': False, 'error': 'Invalid name'}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/reorder', methods=['POST'])
@login_required
def reorder_playlist():
    try:
        data = request.get_json()
        track_ids = data.get('track_ids', [])
        
        if not track_ids:
            return jsonify({'success': False, 'error': 'No tracks provided'}), 400
            
        # Bulk update list_order for user's playlist items
        items = PlaylistItem.query.filter_by(user_id=current_user.id).all()
        item_map = {item.id: item for item in items}
        
        for index, t_id in enumerate(track_ids):
            if int(t_id) in item_map:
                item_map[int(t_id)].list_order = index
                
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/clear', methods=['DELETE'])
@login_required
def clear_playlist():
    try:
        PlaylistItem.query.filter_by(user_id=current_user.id).delete()
        current_user.playlist_name = 'My Playlist'
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/user/delete', methods=['DELETE'])
@login_required
def delete_account():
    try:
        user_id = current_user.id
        # Delete all playlist items for this user
        PlaylistItem.query.filter_by(user_id=user_id).delete()
        # Delete the user
        User.query.filter_by(id=user_id).delete()
        db.session.commit()
        logout_user()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/remove/<int:item_id>', methods=['DELETE'])
@login_required
def remove_from_playlist(item_id):
    try:
        item = PlaylistItem.query.filter_by(id=item_id, user_id=current_user.id).first()
        if not item:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/spotify/login')
@login_required
def spotify_login():
    scope = 'playlist-modify-public playlist-modify-private'
    params = urlencode({
        'client_id': SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'scope': scope,
        'show_dialog': 'true'
    })
    return redirect(f'https://accounts.spotify.com/authorize?{params}')

@app.route('/spotify/callback')
def spotify_callback():
    code = request.args.get('code')
    error = request.args.get('error')
    
    if error or not code:
        flash('Spotify authorization failed')
        return redirect(url_for('playlist'))
    
    token_data = http_requests.post('https://accounts.spotify.com/api/token', data={
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': SPOTIFY_REDIRECT_URI,
        'client_id': SPOTIFY_CLIENT_ID,
        'client_secret': SPOTIFY_CLIENT_SECRET
    }).json()
    
    if 'access_token' in token_data:
        session['spotify_token'] = token_data['access_token']
        return redirect(url_for('playlist') + '?spotify_connected=1')
    
    flash('Failed to get Spotify token')
    return redirect(url_for('playlist'))

@app.route('/api/playlist/export-spotify', methods=['POST'])
@login_required
def export_to_spotify():
    token = session.get('spotify_token')
    if not token:
        return jsonify({'success': False, 'error': 'not_connected'}), 401
    
    try:
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        
        me = http_requests.get('https://api.spotify.com/v1/me', headers=headers).json()
        user_id = me.get('id')
        if not user_id:
            return jsonify({'success': False, 'error': 'token_expired'}), 401
        
        items = current_user.playlist_items
        spotify_uris = [item.spotify_uri for item in items if item.spotify_uri]
        
        if not spotify_uris:
            non_spotify = [item for item in items if not item.spotify_uri]
            for item in non_spotify:
                q = f"track:{item.track_name} artist:{item.artist}"
                result = http_requests.get(
                    'https://api.spotify.com/v1/search',
                    headers=headers,
                    params={'q': q, 'type': 'track', 'limit': 1}
                ).json()
                tracks = result.get('tracks', {}).get('items', [])
                if tracks:
                    spotify_uris.append(tracks[0]['uri'])
        
        if not spotify_uris:
            return jsonify({'success': False, 'error': 'no_tracks'}), 400
        
        playlist_data = http_requests.post(
            f'https://api.spotify.com/v1/users/{user_id}/playlists',
            headers=headers,
            json={
                'name': f'Songfinder - {current_user.username}',
                'description': 'Exported from Songfinder',
                'public': False
            }
        ).json()
        
        playlist_id = playlist_data.get('id')
        if not playlist_id:
            return jsonify({'success': False, 'error': 'create_failed'}), 500
        
        for i in range(0, len(spotify_uris), 100):
            batch = spotify_uris[i:i+100]
            http_requests.post(
                f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks',
                headers=headers,
                json={'uris': batch}
            )
        
        return jsonify({
            'success': True,
            'playlist_url': playlist_data.get('external_urls', {}).get('spotify', ''),
            'tracks_added': len(spotify_uris)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/settings', methods=['POST'])
def update_settings():
    try:
        data = request.get_json()
        
        if current_user.is_authenticated:
            if 'dark_mode' in data: current_user.dark_mode = data['dark_mode']
            if 'language' in data: current_user.language = data['language']
            db.session.commit()
            return jsonify({'success': True, 'settings': current_user.to_dict()['settings']})
        else:
            if 'guest_settings' not in session:
                session['guest_settings'] = {}
            
            session['guest_settings'] = {**session['guest_settings'], **data}
            session.modified = True
            return jsonify({'success': True, 'settings': session['guest_settings']})

    except Exception as e:
        if current_user.is_authenticated:
            db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/user/settings', methods=['GET'])
def get_user_settings():
    if current_user.is_authenticated:
        return jsonify(current_user.to_dict()['settings'])
    else:
        defaults = {
            'dark_mode': 'off',
            'language': 'cs'
        }
        guest_settings = session.get('guest_settings', {})
        return jsonify({**defaults, **guest_settings})

if __name__ == '__main__':
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ssl_ctx.maximum_version = ssl.TLSVersion.TLSv1_3
    ssl_ctx.load_cert_chain(
        os.path.join(os.path.dirname(__file__), 'ssl', 'cert.pem'),
        os.path.join(os.path.dirname(__file__), 'ssl', 'key.pem')
    )
    app.run(debug=True, ssl_context=ssl_ctx)
