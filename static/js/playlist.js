document.addEventListener('DOMContentLoaded', () => {
    const T = window.PLAYLIST_TRANSLATIONS || {};
    const tracksContainer = document.getElementById('playlist-tracks');
    const metaEl = document.getElementById('playlist-meta');
    const footerEl = document.getElementById('playlist-footer');
    const totalTracksEl = document.getElementById('playlist-total-tracks');
    const totalDurationEl = document.getElementById('playlist-total-duration');
    const exportBtn = document.getElementById('export-spotify-btn');
    const toast = document.getElementById('toast');

    let items = window.PLAYLIST_DATA || [];
    items.sort((a, b) => (a.list_order || 0) - (b.list_order || 0));

    const titleInput = document.getElementById('playlist-title-input');
    if (titleInput) {
        titleInput.addEventListener('change', async (e) => {
            const newName = e.target.value.trim();
            if (!newName) return;
            try {
                const resp = await fetch('/api/playlist/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName })
                });
                const data = await resp.json();
                if (data.success) {
                    showToast('Playlist renamed', 'success');
                } else {
                    showToast('Failed to rename playlist', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Error renaming playlist', 'error');
            }
        });
    }

    if (window.SPOTIFY_CONNECTED) {
        showToast('Spotify connected! Click Export again.', 'success');
    }

    let draggedItem = null;

    function renderPlaylist() {
        if (!tracksContainer) return;

        if (items.length === 0) {
            tracksContainer.innerHTML = `
                <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 1rem; opacity: 0.5;">
                        <path d="M9 18V5l12-2v13"></path>
                        <circle cx="6" cy="18" r="3"></circle>
                        <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                    <p>${T.playlist_empty || 'Your playlist is empty. Search for songs and add them!'}</p>
                </div>`;
            if (footerEl) footerEl.style.display = 'none';
            updateMeta();
            return;
        }

        tracksContainer.innerHTML = '';
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'track';
            row.dataset.id = item.id;
            row.draggable = true;

            const mins = Math.floor(item.duration_ms / 60000);
            const secs = Math.floor((item.duration_ms % 60000) / 1000).toString().padStart(2, '0');
            const durationStr = item.duration_ms ? `${mins}:${secs}` : '';

            let badgeClass = 'source-badge--spotify';
            let badgeText = 'Spotify';
            if (item.source === 'lastfm') { badgeClass = 'source-badge--lastfm'; badgeText = 'Last.fm'; }
            if (item.source === 'soundcharts') { badgeClass = 'source-badge--soundcharts'; badgeText = 'SC'; }

            row.innerHTML = `
                <div class="track__drag-handle" title="Drag to reorder">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                </div>
                <span class="track__number" style="width:1rem;">${index + 1}</span>
                <img src="${item.image || 'static/images/default-album.png'}" alt="${item.track_name}" class="track__image">
                <div class="track__info">
                    <span class="track__name">${item.track_name}</span>
                    <span class="track__artist">${item.artist}${item.album ? ' • ' + item.album : ''}</span>
                </div>
                <span class="source-badge ${badgeClass}" style="font-size: 0.6rem;">${badgeText}</span>
                <span class="track__duration">${durationStr}</span>
                <button class="track__remove" data-id="${item.id}" title="${T.remove_from_playlist || 'Remove'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;

            // Drag and drop events
            row.addEventListener('dragstart', (e) => {
                draggedItem = row;
                setTimeout(() => row.classList.add('dragging'), 0);
            });

            row.addEventListener('dragend', () => {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                document.querySelectorAll('.track').forEach(t => t.classList.remove('drag-over'));
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                row.classList.add('drag-over');
            });

            row.addEventListener('dragleave', () => {
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', async (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
                if (draggedItem === row) return;

                const allTracks = [...tracksContainer.querySelectorAll('.track')];
                const draggedIdx = allTracks.indexOf(draggedItem);
                const targetIdx = allTracks.indexOf(row);

                if (draggedIdx < targetIdx) {
                    row.after(draggedItem);
                } else {
                    row.before(draggedItem);
                }

                // Update numbers visually immediately
                tracksContainer.querySelectorAll('.track').forEach((t, i) => {
                    t.querySelector('.track__number').textContent = i + 1;
                });

                // Save new order to db
                const trackIds = [...tracksContainer.querySelectorAll('.track')].map(t => parseInt(t.dataset.id));
                try {
                    await fetch('/api/playlist/reorder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ track_ids: trackIds })
                    });

                    // Update local items array order
                    items.sort((a, b) => trackIds.indexOf(a.id) - trackIds.indexOf(b.id));
                } catch (err) {
                    console.error('Failed to save order', err);
                    showToast('Failed to save new order', 'error');
                }
            });

            tracksContainer.appendChild(row);
        });

        document.querySelectorAll('.track__remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    const resp = await fetch(`/api/playlist/remove/${id}`, { method: 'DELETE' });
                    const data = await resp.json();
                    if (data.success) {
                        items = items.filter(i => i.id != id);
                        renderPlaylist();
                        showToast(T.remove_from_playlist || 'Removed', 'info');
                    }
                } catch (err) {
                    console.error(err);
                }
            });
        });

        if (footerEl) footerEl.style.display = 'flex';
        updateMeta();
    }

    function updateMeta() {
        const count = items.length;
        const totalMs = items.reduce((sum, i) => sum + (i.duration_ms || 0), 0);
        const totalMins = Math.floor(totalMs / 60000);

        if (metaEl) {
            metaEl.textContent = `${count} ${count === 1 ? 'track' : 'tracks'} • ${totalMins} min`;
        }
        if (totalTracksEl) {
            let tpl = T.total_tracks || '{count} tracks';
            totalTracksEl.textContent = tpl.replace('{count}', count);
        }
        if (totalDurationEl) {
            let tpl = T.total_duration || '{mins} min';
            totalDurationEl.textContent = tpl.replace('{mins}', totalMins);
        }
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (items.length === 0) {
                showToast(T.playlist_empty || 'Playlist is empty', 'error');
                return;
            }

            exportBtn.disabled = true;
            exportBtn.textContent = '...';

            try {
                const resp = await fetch('/api/playlist/export-spotify', { method: 'POST' });
                const data = await resp.json();

                if (data.success) {
                    showToast((T.export_success || 'Exported!') + ` (${data.tracks_added} tracks)`, 'success');
                    if (data.playlist_url) {
                        setTimeout(() => window.open(data.playlist_url, '_blank'), 1500);
                    }
                } else if (data.error === 'not_connected' || data.error === 'token_expired') {
                    window.location.href = '/spotify/login';
                } else {
                    showToast('Export failed: ' + (data.error || 'unknown'), 'error');
                }
            } catch (err) {
                showToast('Export failed', 'error');
                console.error(err);
            } finally {
                exportBtn.disabled = false;
                exportBtn.textContent = T.export_spotify || 'Export to Spotify';
            }
        });
    }

    const clearBtn = document.getElementById('clear-playlist-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if (items.length === 0) return;
            if (confirm('Opravdu chcete smazat celý playlist? (Are you sure you want to clear the playlist?)')) {
                try {
                    const resp = await fetch('/api/playlist/clear', { method: 'DELETE' });
                    const data = await resp.json();
                    if (data.success) {
                        items = [];
                        renderPlaylist();
                        showToast('Playlist smazán (Playlist cleared)', 'info');
                    } else {
                        showToast('Chyba při mazání playlistu', 'error');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Error', 'error');
                }
            }
        });
    }

    function showToast(msg, type) {
        if (!toast) return;
        toast.textContent = msg;
        toast.className = `toast toast--${type || 'info'} toast--show`;
        setTimeout(() => { toast.className = 'toast'; }, 3000);
    }

    renderPlaylist();
});
