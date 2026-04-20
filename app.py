from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, session, Response
import os
from dotenv import load_dotenv
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_seasurf import SeaSurf
from models import db, User, Playlist, PlaylistItem
import json
import requests as http_requests
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix
from utils.youtube import YoutubeClient
from utils.lastfm import LastfmClient
from utils.soundcharts import SoundchartsClient
from urllib.parse import urlencode
import ssl
from datetime import datetime
from sqlalchemy import inspect, text
import secrets

try:
    with open(os.path.join(os.path.dirname(__file__), 'utils', 'translations.json'), 'r', encoding='utf-8') as f:
        TRANSLATIONS = json.load(f)
except Exception:
    TRANSLATIONS = {}

load_dotenv()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev_key')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///songfinder.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['CSRF_CHECK_REFERER'] = False

csrf = SeaSurf(app)

db.init_app(app)
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.init_app(app)
youtube_client = YoutubeClient()
lastfm_client = LastfmClient()
soundcharts_client = SoundchartsClient()

def _generate_unique_share_token():
    for _ in range(24):
        token = secrets.token_urlsafe(18)
        if not Playlist.query.filter_by(share_token=token).first():
            return token
    return f"{secrets.token_urlsafe(24)}-{int(datetime.utcnow().timestamp())}"

def _ensure_playlist_share_columns():
    inspector = inspect(db.engine)
    columns = {column['name'] for column in inspector.get_columns('playlist')}

    with db.engine.begin() as conn:
        if 'is_public' not in columns:
            conn.execute(text("ALTER TABLE playlist ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT 0"))
        if 'share_token' not in columns:
            conn.execute(text("ALTER TABLE playlist ADD COLUMN share_token VARCHAR(64)"))

        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_playlist_share_token ON playlist (share_token)"))

        missing_rows = conn.execute(
            text("SELECT id FROM playlist WHERE share_token IS NULL OR share_token = ''")
        ).fetchall()

        for row in missing_rows:
            token = secrets.token_urlsafe(18)
            while conn.execute(
                text("SELECT 1 FROM playlist WHERE share_token = :token"),
                {'token': token}
            ).fetchone():
                token = secrets.token_urlsafe(18)

            conn.execute(
                text("UPDATE playlist SET share_token = :token WHERE id = :playlist_id"),
                {'token': token, 'playlist_id': row.id}
            )

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

@app.context_processor
def inject_translations():
    # Priority: Query Param > User Settings > Session > Default
    lang = request.args.get('lang')
    if not lang or lang not in TRANSLATIONS:
        if current_user.is_authenticated and current_user.language:
            lang = current_user.language
        elif 'guest_settings' in session and 'language' in session['guest_settings']:
            lang = session['guest_settings']['language']
    
    if not lang or lang not in TRANSLATIONS:
        lang = 'cs'
    
    theme = 'off'
    if current_user.is_authenticated and current_user.dark_mode:
        theme = current_user.dark_mode
    elif 'guest_settings' in session and 'dark_mode' in session['guest_settings']:
        theme = session['guest_settings']['dark_mode']
        
    return dict(
        t=TRANSLATIONS.get(lang, TRANSLATIONS['cs']), 
        active_theme=theme, 
        lang=lang, 
        is_admin=(current_user.is_authenticated and getattr(current_user, 'username', None) == 'admin')
    )

with app.app_context():
    db.create_all()
    _ensure_playlist_share_columns()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/playlist')
def playlist():
    try:
        items = []
        playlist_name = 'My Playlist'
        playlists = []
        active_playlist_id = None
        
        if current_user.is_authenticated:
            # Check if user has any playlists
            if not current_user.playlists:
                default_playlist = Playlist(user_id=current_user.id, name='My Playlist')
                default_playlist.generate_slug()
                db.session.add(default_playlist)
                db.session.commit()
            
            playlists = Playlist.query.filter_by(user_id=current_user.id).all()
            
            # Get playlist from query param (slug or id) or use the first one
            slug = request.args.get('slug')
            p_id = request.args.get('id', type=int)
            
            active_playlist = None
            if slug:
                active_playlist = next((p for p in playlists if p.slug == slug), None)
            
            if not active_playlist and p_id:
                active_playlist = next((p for p in playlists if p.id == p_id), None)
                
            if not active_playlist:
                active_playlist = playlists[0]
            
            items = [item.to_dict() for item in active_playlist.items]
            playlist_name = active_playlist.name
            active_playlist_id = active_playlist.id
        
        # Pre-serialize to avoid potential tojson issues in template
        items_json = json.dumps(items)
        playlists_json = json.dumps([p.to_dict() for p in playlists])
        
        return render_template('playlist.html', 
                               playlist_items_json=items_json, 
                               playlist_name=playlist_name,
                               playlists=playlists,
                               active_playlist_id=active_playlist_id,
                               playlists_json=playlists_json)
    except Exception as e:
        app.logger.error(f"Error in playlist route: {e}")
        return f"Internal Server Error: {e}", 500

@app.route('/playlist/shared/<share_token>')
def shared_playlist(share_token):
    playlist = Playlist.query.filter_by(share_token=share_token, is_public=True).first()
    if not playlist:
        return render_template('shared_playlist.html', playlist=None, items=[]), 404

    return render_template(
        'shared_playlist.html',
        playlist=playlist,
        items=list(playlist.items),
        owner_name=playlist.user.username if playlist.user else ''
    )

@app.route('/api/user/change-password', methods=['POST'])
@login_required
def change_password():
    try:
        data = request.get_json()
        old_password = data.get('old_password')
        new_password = data.get('new_password')
        confirm_password = data.get('confirm_password')

        if not old_password or not new_password or not confirm_password:
            return jsonify({'success': False, 'error': 'All fields are required'}), 400

        if new_password != confirm_password:
            return jsonify({'success': False, 'error': 'New passwords do not match'}), 400

        if not current_user.check_password(old_password):
            return jsonify({'success': False, 'error': 'Invalid current password'}), 400

        current_user.set_password(new_password)
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

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
        
        if user and user.check_password(password):
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
            
        new_user = User(username=username)
        new_user.set_password(password)
        
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

from yt_dlp import YoutubeDL
import io
from flask import send_file

@app.route('/api/download/<youtube_id>')
@login_required
def download_audio(youtube_id):
    if current_user.username != 'admin':
        return jsonify({'success': False, 'error': 'Forbidden'}), 403
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': '-', # Stream to stdout
            'logtostderr': True,
            'quiet': True,
        }
        
        url = f"https://www.youtube.com/watch?v={youtube_id}"
        
        # We'll use a temporary file or pipe. Streaming directly is tricky with yt-dlp post-processors.
        # For simplicity and reliability, we'll download to a buffer if it's not too large, 
        # but yt-dlp prefers files. Let's use a simple approach for now.
        
        # Get info first to get the title
        with YoutubeDL({'quiet': True}) as ydl:
            info = ydl.extract_info(url, download=False)
            filename = f"{info.get('title', 'audio')}.mp3"

        def generate():
            # Use a more memory-efficient way for larger files if needed, 
            # but for audio 192kbps it's usually fine.
            cmd = [
                'yt-dlp',
                '-x', '--audio-format', 'mp3',
                '--audio-quality', '192K',
                '-o', '-', 
                url
            ]
            import subprocess
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            while True:
                data = proc.stdout.read(1024*1024) # 1MB chunks
                if not data:
                    break
                yield data
            proc.wait()

        return Response(generate(), 
                        mimetype="audio/mpeg",
                        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/download/<int:item_id>')
@login_required
def download_playlist_item(item_id):
    if current_user.username != 'admin':
        return jsonify({'success': False, 'error': 'Forbidden'}), 403
    item = PlaylistItem.query.join(Playlist).filter(
        PlaylistItem.id == item_id,
        Playlist.user_id == current_user.id
    ).first()
    
    if not item or not item.youtube_id:
        # If no youtube_id, try to find one via search
        if item:
            results = youtube_client.search_tracks(f"{item.track_name} {item.artist}", limit=1)
            if results and isinstance(results, list) and len(results) > 0:
                return redirect(url_for('download_audio', youtube_id=results[0]['id']))
        
        return jsonify({'success': False, 'error': 'Track not found or not downloadable'}), 404
        
    return redirect(url_for('download_audio', youtube_id=item.youtube_id))

@app.route('/api/search')
def search():
    query = request.args.get('q', '').strip()
    limit = request.args.get('limit', 20, type=int)
    source = request.args.get('source', 'youtube')
    
    if not query:
        return jsonify([])
    
    if source == 'lastfm':
        results = lastfm_client.search_tracks(query, limit=limit)
    elif source == 'soundcharts':
        results = soundcharts_client.search_tracks(query, limit=limit)
    else:
        genres = ['rock', 'pop', 'jazz', 'classical', 'metal', 'hip-hop', 'electronic']
        search_type = 'genre' if query.lower() in genres else 'track'
        results = youtube_client.search_tracks(query, limit=limit, search_type=search_type)
        if isinstance(results, dict) and 'error' in results:
            return jsonify([])
    
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
    slug = request.args.get('slug')
    playlist_id = request.args.get('id', type=int)
    
    if slug:
        playlist = Playlist.query.filter_by(slug=slug, user_id=current_user.id).first()
    elif playlist_id:
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    else:
        playlist = current_user.playlists[0] if current_user.playlists else None
        
    if not playlist:
        return jsonify([])
        
    items = [item.to_dict() for item in playlist.items]
    return jsonify(items)

@app.route('/api/playlist/share/<int:playlist_id>', methods=['GET', 'POST'])
@login_required
def playlist_share_settings(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'success': False, 'error': 'Playlist not found'}), 404

    try:
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            playlist.is_public = bool(data.get('is_public'))
            if not playlist.share_token:
                playlist.share_token = _generate_unique_share_token()
            db.session.commit()
        else:
            if not playlist.share_token:
                playlist.share_token = _generate_unique_share_token()
                db.session.commit()

        share_url = url_for('shared_playlist', share_token=playlist.share_token, _external=True)
        return jsonify({
            'success': True,
            'is_public': bool(playlist.is_public),
            'share_token': playlist.share_token,
            'share_url': share_url
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

def _extract_import_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get('items'), list):
            return payload['items']
        playlist_obj = payload.get('playlist')
        if isinstance(playlist_obj, dict) and isinstance(playlist_obj.get('items'), list):
            return playlist_obj['items']
    return None

def _normalize_import_item(raw_item):
    if not isinstance(raw_item, dict):
        return None

    track_name = str(raw_item.get('track_name') or raw_item.get('name') or '').strip()
    artist = str(raw_item.get('artist') or '').strip()
    if not track_name:
        return None
    if not artist:
        artist = 'Unknown Artist'

    source = str(raw_item.get('source') or 'youtube').strip().lower()
    if source not in {'youtube', 'lastfm', 'soundcharts'}:
        source = 'youtube'

    youtube_id = str(raw_item.get('youtube_id') or '').strip()
    if source == 'youtube' and not youtube_id:
        youtube_id = str(raw_item.get('id') or '').strip()

    duration_raw = raw_item.get('duration_ms', raw_item.get('durationMs', 0))
    try:
        duration_ms = max(0, int(duration_raw or 0))
    except (TypeError, ValueError):
        duration_ms = 0

    return {
        'track_name': track_name,
        'artist': artist,
        'album': str(raw_item.get('album') or raw_item.get('album_name') or '').strip(),
        'image': str(raw_item.get('image') or raw_item.get('image_url') or '').strip(),
        'external_url': str(raw_item.get('external_url') or raw_item.get('url') or '').strip(),
        'source': source,
        'youtube_id': youtube_id,
        'duration_ms': duration_ms
    }

@app.route('/api/playlist/export/<int:playlist_id>', methods=['GET'])
@login_required
def export_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'success': False, 'error': 'Playlist not found'}), 404

    items = [item.to_dict() for item in playlist.items]
    payload = {
        'format': 'songfinder-playlist-v1',
        'exported_at': datetime.utcnow().isoformat() + 'Z',
        'playlist': {
            'name': playlist.name,
            'slug': playlist.slug
        },
        'items': items
    }

    filename_slug = playlist.slug or f'playlist-{playlist.id}'
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    filename = f'{filename_slug}-{timestamp}.json'

    return Response(
        json.dumps(payload, ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Cache-Control': 'no-store'
        }
    )

@app.route('/api/playlist/import/<int:playlist_id>', methods=['POST'])
@login_required
def import_playlist(playlist_id):
    playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
    if not playlist:
        return jsonify({'success': False, 'error': 'Playlist not found'}), 404

    mode = str(request.form.get('mode') or request.args.get('mode') or 'append').strip().lower()
    if mode not in {'append', 'replace'}:
        mode = 'append'

    payload = None
    upload = request.files.get('file')
    if upload:
        raw_bytes = upload.read((5 * 1024 * 1024) + 1)
        if len(raw_bytes) > 5 * 1024 * 1024:
            return jsonify({'success': False, 'error': 'File is too large (max 5MB)'}), 400
        try:
            payload = json.loads(raw_bytes.decode('utf-8-sig'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return jsonify({'success': False, 'error': 'Invalid JSON file'}), 400
    else:
        payload = request.get_json(silent=True)
        if payload is None:
            return jsonify({'success': False, 'error': 'No JSON payload provided'}), 400

    items_raw = _extract_import_items(payload)
    if not isinstance(items_raw, list):
        return jsonify({'success': False, 'error': 'JSON must contain an items array'}), 400
    if len(items_raw) > 2000:
        return jsonify({'success': False, 'error': 'Too many items (max 2000)'}), 400

    normalized_items = []
    skipped_count = 0
    for raw in items_raw:
        normalized = _normalize_import_item(raw)
        if normalized:
            normalized_items.append(normalized)
        else:
            skipped_count += 1

    if not normalized_items:
        return jsonify({'success': False, 'error': 'No valid tracks to import'}), 400

    try:
        if mode == 'replace':
            PlaylistItem.query.filter_by(playlist_id=playlist.id).delete()
            next_order = 1
        else:
            max_order = db.session.query(db.func.max(PlaylistItem.list_order)) \
                .filter_by(playlist_id=playlist.id).scalar() or 0
            next_order = max_order + 1

        for item in normalized_items:
            db.session.add(
                PlaylistItem(
                    playlist_id=playlist.id,
                    list_order=next_order,
                    track_name=item['track_name'],
                    artist=item['artist'],
                    album=item['album'],
                    image=item['image'],
                    external_url=item['external_url'],
                    source=item['source'],
                    youtube_id=item['youtube_id'],
                    duration_ms=item['duration_ms']
                )
            )
            next_order += 1

        db.session.commit()
        playlist_items = [item.to_dict() for item in playlist.items]
        return jsonify({
            'success': True,
            'mode': mode,
            'imported_count': len(normalized_items),
            'skipped_count': skipped_count,
            'items': playlist_items
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/add', methods=['POST'])
@login_required
def add_to_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        
        if not playlist_id:
            if current_user.playlists:
                playlist_id = current_user.playlists[0].id
            else:
                default_playlist = Playlist(user_id=current_user.id, name='My Playlist')
                default_playlist.generate_slug()
                db.session.add(default_playlist)
                db.session.commit()
                playlist_id = default_playlist.id
        
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
        if not playlist:
            return jsonify({'success': False, 'error': 'Playlist not found'}), 404

        youtube_id = ''
        if data.get('source') == 'youtube' and data.get('id'):
            youtube_id = data['id']
        
        # Get max list_order for THIS playlist
        max_order = db.session.query(db.func.max(PlaylistItem.list_order))\
            .filter_by(playlist_id=playlist_id).scalar() or 0
        
        item = PlaylistItem(
            playlist_id=playlist_id,
            list_order=max_order + 1,
            track_name=data.get('name', ''),
            artist=data.get('artist', ''),
            album=data.get('album', ''),
            image=data.get('image', ''),
            external_url=data.get('external_url', ''),
            source=data.get('source', 'youtube'),
            youtube_id=youtube_id,
            duration_ms=data.get('duration_ms', 0)
        )
        
        db.session.add(item)
        db.session.commit()
        
        return jsonify({'success': True, 'item': item.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/create', methods=['POST'])
@login_required
def create_playlist():
    try:
        data = request.get_json()
        name = data.get('name', 'New Playlist').strip() or 'New Playlist'
        
        new_playlist = Playlist(user_id=current_user.id, name=name)
        new_playlist.generate_slug()
        db.session.add(new_playlist)
        db.session.commit()
        
        return jsonify({'success': True, 'playlist': new_playlist.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/delete/<int:playlist_id>', methods=['POST', 'DELETE'])
@login_required
def delete_playlist(playlist_id):
    try:
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
        if not playlist:
            return jsonify({'success': False, 'error': 'Playlist not found'}), 404
        
        db.session.delete(playlist)
        db.session.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/rename/<int:playlist_id>', methods=['POST'])
@login_required
def rename_playlist(playlist_id):
    try:
        data = request.get_json()
        new_name = data.get('name', '').strip()
        
        if not new_name:
            return jsonify({'success': False, 'error': 'Missing data'}), 400
            
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
        if not playlist:
            return jsonify({'success': False, 'error': 'Playlist not found'}), 404
            
        playlist.name = new_name
        playlist.generate_slug()
        db.session.commit()
        return jsonify({'success': True, 'name': new_name, 'slug': playlist.slug})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/reorder', methods=['POST'])
@login_required
def reorder_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        track_ids = data.get('track_ids', [])
        
        if not playlist_id or not track_ids:
            return jsonify({'success': False, 'error': 'Missing data'}), 400
            
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
        if not playlist:
            return jsonify({'success': False, 'error': 'Playlist not found'}), 404

        item_map = {item.id: item for item in playlist.items}
        
        for index, t_id in enumerate(track_ids):
            if int(t_id) in item_map:
                item_map[int(t_id)].list_order = index
                
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/clear/<int:playlist_id>', methods=['POST', 'DELETE'])
@login_required
def clear_playlist(playlist_id):
    try:
        playlist = Playlist.query.filter_by(id=playlist_id, user_id=current_user.id).first()
        if not playlist:
            return jsonify({'success': False, 'error': 'Playlist not found'}), 404
            
        PlaylistItem.query.filter_by(playlist_id=playlist_id).delete()
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/user/delete', methods=['DELETE'])
@login_required
def delete_account():
    try:
        user = User.query.get(current_user.id)
        db.session.delete(user)
        db.session.commit()
        logout_user()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/playlist/remove/<int:item_id>', methods=['POST', 'DELETE'])
@login_required
def remove_from_playlist(item_id):
    try:
        # Join with Playlist to ensure the item belongs to a playlist owned by the current user
        item = PlaylistItem.query.join(Playlist).filter(
            PlaylistItem.id == item_id,
            Playlist.user_id == current_user.id
        ).first()
        
        if not item:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        
        db.session.delete(item)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
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

@app.route('/admin')
@login_required
def admin_panel():
    if current_user.username != 'admin':
        return redirect(url_for('index'))
    users = User.query.all()
    return render_template('admin.html', users=users)

@app.route('/admin/delete_user/<int:user_id>', methods=['POST'])
@login_required
def admin_delete_user(user_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    user = User.query.get(user_id)
    if user and user.username != 'admin':
        db.session.delete(user)
        db.session.commit()
        flash(f'User {user.username} deleted.')

    return redirect(url_for('admin_panel'))

@app.route('/admin/edit_user/<int:user_id>', methods=['POST'])
@login_required
def admin_edit_user(user_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    user = User.query.get(user_id)
    if not user:
        flash('User not found.')
        return redirect(url_for('admin_panel'))

    new_username = request.form.get('username')
    new_password = request.form.get('password')

    if new_username and new_username != user.username:
        if User.query.filter_by(username=new_username).first():
            flash('Username already exists.')
        else:
            user.username = new_username
            flash(f'Username updated to {new_username}.')

    if new_password:
        user.set_password(new_password)
        flash('Password updated.')

    db.session.commit()
    return redirect(url_for('admin_panel'))

@app.route('/admin/user/<int:user_id>/playlists')
@login_required
def admin_view_playlists(user_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    user = User.query.get(user_id)
    if not user:
        flash('User not found.')
        return redirect(url_for('admin_panel'))

    return render_template('admin_playlists.html', user=user)

@app.route('/admin/playlist/delete/<int:playlist_id>', methods=['POST'])
@login_required
def admin_delete_playlist(playlist_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    playlist = Playlist.query.get(playlist_id)
    if playlist:
        user_id = playlist.user_id
        db.session.delete(playlist)
        db.session.commit()
        flash('Playlist deleted.')
        return redirect(url_for('admin_view_playlists', user_id=user_id))

    return redirect(url_for('admin_panel'))

@app.route('/admin/track/delete/<int:item_id>', methods=['POST'])
@login_required
def admin_delete_track(item_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    item = PlaylistItem.query.get(item_id)
    if item:
        playlist_id = item.playlist_id
        db.session.delete(item)
        db.session.commit()
        flash('Track removed.')

        playlist = Playlist.query.get(playlist_id)
        if playlist:
            return redirect(url_for('admin_view_playlists', user_id=playlist.user_id))

    return redirect(url_for('admin_panel'))

@app.route('/admin/playlist/<int:playlist_id>/clear', methods=['POST'])
@login_required
def admin_clear_playlist(playlist_id):
    if current_user.username != 'admin':
        return redirect(url_for('index'))

    playlist = Playlist.query.get(playlist_id)
    if playlist:
        PlaylistItem.query.filter_by(playlist_id=playlist_id).delete()
        db.session.commit()
        flash('Playlist cleared.')
        return redirect(url_for('admin_view_playlists', user_id=playlist.user_id))

    return redirect(url_for('admin_panel'))

if __name__ == '__main__':
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    ssl_ctx.maximum_version = ssl.TLSVersion.TLSv1_3
    ssl_ctx.load_cert_chain(
        os.path.join(os.path.dirname(__file__), 'ssl', 'cert.pem'),
        os.path.join(os.path.dirname(__file__), 'ssl', 'key.pem')
    )
    app.run(debug=True, ssl_context=ssl_ctx)
