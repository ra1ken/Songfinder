from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

db = SQLAlchemy()

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    
    dark_mode = db.Column(db.String(10), default='off')
    language = db.Column(db.String(5), default='cs')
    
    playlist_name = db.Column(db.String(100), default='My Playlist')
    playlist_items = db.relationship('PlaylistItem', backref='user', lazy=True, order_by='PlaylistItem.list_order')

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

class PlaylistItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    list_order = db.Column(db.Integer, default=0)
    track_name = db.Column(db.String(200), nullable=False)
    artist = db.Column(db.String(200), nullable=False)
    album = db.Column(db.String(200), default='')
    image = db.Column(db.String(500), default='')
    external_url = db.Column(db.String(500), default='')
    source = db.Column(db.String(20), default='spotify')
    spotify_uri = db.Column(db.String(100), default='')
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
            'spotify_uri': self.spotify_uri,
            'duration_ms': self.duration_ms,
            'added_at': self.added_at.isoformat() if self.added_at else ''
        }
