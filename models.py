from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import re
import secrets

db = SQLAlchemy()

def _generate_share_token():
    return secrets.token_urlsafe(18)

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255))
    
    dark_mode = db.Column(db.String(10), default='off')
    language = db.Column(db.String(5), default='cs')
    
    playlists = db.relationship('Playlist', backref='user', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'username': self.username,
            'settings': {
                'dark_mode': self.dark_mode,
                'language': self.language
            }
        }

class Playlist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), default='My Playlist')
    slug = db.Column(db.String(120), nullable=False)
    is_public = db.Column(db.Boolean, default=False, nullable=False)
    share_token = db.Column(db.String(64), unique=True, index=True, nullable=False, default=_generate_share_token)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    items = db.relationship('PlaylistItem', backref='playlist', lazy=True, cascade="all, delete-orphan", order_by='PlaylistItem.list_order')

    def generate_slug(self):
        # Basic slugify
        s = self.name.lower()
        s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
        if not s: s = 'playlist'
        
        # Uniqueness check (within user's playlists)
        base_slug = s
        counter = 1
        original_s = s
        while Playlist.query.filter_by(user_id=self.user_id, slug=s).filter(Playlist.id != self.id).first():
            s = f"{original_s}-{counter}"
            counter += 1
        self.slug = s

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'slug': self.slug,
            'is_public': self.is_public,
            'share_token': self.share_token,
            'created_at': self.created_at.isoformat() if self.created_at else '',
            'item_count': len(self.items)
        }

class PlaylistItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    playlist_id = db.Column(db.Integer, db.ForeignKey('playlist.id'), nullable=False)
    list_order = db.Column(db.Integer, default=0)
    track_name = db.Column(db.String(200), nullable=False)
    artist = db.Column(db.String(200), nullable=False)
    album = db.Column(db.String(200), default='')
    image = db.Column(db.String(500), default='')
    external_url = db.Column(db.String(500), default='')
    source = db.Column(db.String(20), default='youtube')
    youtube_id = db.Column(db.String(100), default='')
    duration_ms = db.Column(db.Integer, default=0)
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'list_order': self.list_order,
            'track_name': self.track_name,
            'artist': self.artist,
            'album': self.album,
            'image': self.image,
            'external_url': self.external_url,
            'source': self.source,
            'youtube_id': self.youtube_id,
            'duration_ms': self.duration_ms,
            'added_at': self.added_at.isoformat() if self.added_at else ''
        }
