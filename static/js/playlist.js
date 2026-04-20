document.addEventListener('DOMContentLoaded', () => {
    const T = window.PLAYLIST_TRANSLATIONS || {};
    const tracksContainer = document.getElementById('playlist-tracks');
    const metaEl = document.getElementById('playlist-meta');
    const footerEl = document.getElementById('playlist-footer');
    const totalTracksEl = document.getElementById('playlist-total-tracks');
    const totalDurationEl = document.getElementById('playlist-total-duration');
    const toast = document.getElementById('toast');
    const toggleShareBtn = document.getElementById('toggle-share-btn');
    const copyShareLinkBtn = document.getElementById('copy-share-link-btn');
    const shareLinkInput = document.getElementById('share-link-input');
    const openShareLinkBtn = document.getElementById('open-share-link-btn');

    let items = window.PLAYLIST_DATA || [];
    let activePlaylistId = window.ACTIVE_PLAYLIST_ID;
    let shareState = {
        isPublic: false,
        shareUrl: ''
    };
    items.sort((a, b) => (a.list_order || 0) - (b.list_order || 0));

    function getCsrfToken() {
        const tokenMeta = document.querySelector('meta[name="csrf-token"]');
        return tokenMeta ? tokenMeta.getAttribute('content') : '';
    }

    const createPlaylistBtn = document.getElementById('create-playlist-btn');
    
    // Sidebar playlist switching
    document.querySelectorAll('.playlist-sidebar__item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Let the href handle it unless we want AJAX later
            // For now, ensure it works.
        });
    });

    if (createPlaylistBtn) {
        createPlaylistBtn.addEventListener('click', async () => {
            const name = prompt('Název nového playlistu: (New playlist name:)', 'New Playlist');
            if (name === null) return;
            try {
                const resp = await fetch('api/playlist/create', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ name: name || 'New Playlist' })
                });
                const data = await resp.json();
                if (data.success) {
                    window.location.href = `playlist?slug=${data.playlist.slug}`;
                } else {
                    showToast('Failed to create playlist', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Error creating playlist', 'error');
            }
        });
    }

    const titleInput = document.getElementById('playlist-title-input');
    if (titleInput) {
        titleInput.addEventListener('change', async (e) => {
            const newName = e.target.value.trim();
            if (!newName) return;
            try {
                const resp = await fetch(`api/playlist/rename/${activePlaylistId}`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ name: newName })
                });
                const data = await resp.json();
                if (data.success) {
                    showToast('Playlist renamed', 'success');
                    // Update sidebar if needed or just reload
                    const activeSidebarItem = document.querySelector('.playlist-sidebar__item.active .playlist-sidebar__item-name');
                    if (activeSidebarItem) activeSidebarItem.textContent = newName;
                } else {
                    showToast('Error renaming playlist', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Error renaming playlist', 'error');
            }
        });
    }

    const deleteBtn = document.getElementById('delete-playlist-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(T.delete_confirm)) return;
            try {
                const resp = await fetch(`api/playlist/delete/${activePlaylistId}`, {
                    method: 'DELETE',
                    headers: {
                        'X-CSRFToken': getCsrfToken()
                    }
                });
                const data = await resp.json();
                if (data.success) {
                    window.location.href = 'playlist';
                } else {
                    showToast('Error deleting playlist: ' + (data.error || 'unknown'), 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Error deleting playlist', 'error');
            }
        });
    }

    function renderShareState() {
        if (!toggleShareBtn) return;

        toggleShareBtn.textContent = shareState.isPublic
            ? (T.share_make_private || 'Make Private')
            : (T.share_make_public || 'Make Public');

        if (copyShareLinkBtn) {
            copyShareLinkBtn.style.display = shareState.isPublic ? '' : 'none';
            copyShareLinkBtn.textContent = T.share_copy_link || 'Copy Link';
        }

        if (shareLinkInput) {
            shareLinkInput.value = shareState.shareUrl || '';
            shareLinkInput.style.display = shareState.isPublic ? '' : 'none';
        }

        if (openShareLinkBtn) {
            if (shareState.isPublic && shareState.shareUrl) {
                openShareLinkBtn.href = shareState.shareUrl;
                openShareLinkBtn.style.display = '';
                openShareLinkBtn.textContent = T.share_open_link || 'Open Link';
            } else {
                openShareLinkBtn.removeAttribute('href');
                openShareLinkBtn.style.display = 'none';
            }
        }
    }

    async function fetchShareState() {
        if (!activePlaylistId) return;
        try {
            const resp = await fetch(`api/playlist/share/${activePlaylistId}`);
            const data = await resp.json();
            if (resp.ok && data.success) {
                shareState.isPublic = !!data.is_public;
                shareState.shareUrl = data.share_url || '';
                renderShareState();
            }
        } catch (err) {
            console.error('Failed to fetch share settings:', err);
        }
    }

    async function updateShareState(nextPublic) {
        if (!activePlaylistId) return;

        try {
            const resp = await fetch(`api/playlist/share/${activePlaylistId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ is_public: !!nextPublic })
            });

            const data = await resp.json();
            if (!resp.ok || !data.success) {
                showToast((data && data.error) || T.share_update_failed || 'Failed to update sharing', 'error');
                return;
            }

            shareState.isPublic = !!data.is_public;
            shareState.shareUrl = data.share_url || '';
            renderShareState();
        } catch (err) {
            console.error(err);
            showToast(T.share_update_failed || 'Failed to update sharing', 'error');
        }
    }

    if (toggleShareBtn) {
        toggleShareBtn.addEventListener('click', async () => {
            await updateShareState(!shareState.isPublic);
        });
    }

    if (copyShareLinkBtn) {
        copyShareLinkBtn.addEventListener('click', async () => {
            if (!shareState.shareUrl) return;
            try {
                await navigator.clipboard.writeText(shareState.shareUrl);
                showToast(T.share_copy_success || 'Share link copied', 'success');
            } catch (err) {
                console.error(err);
                if (shareLinkInput) {
                    shareLinkInput.focus();
                    shareLinkInput.select();
                }
            }
        });
    }

    let draggedItem = null;

    function renderPlaylist() {
        if (!tracksContainer) return;
        tracksContainer.innerHTML = '';

        if (items.length === 0) {
            tracksContainer.innerHTML = `<div class="playlist-empty"><p>${sanitizeHTML(T.playlist_empty || 'Playlist is empty')}</p></div>`;
            footerEl.style.display = 'none';
            return;
        }

        footerEl.style.display = 'block';

        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'track';
            row.draggable = true;
            row.dataset.id = item.id;
            row.dataset.index = index;

            const mins = Math.floor(item.duration_ms / 60000);
            const secs = Math.floor((item.duration_ms % 60000) / 1000);
            const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

            let badgeClass = 'source-badge--youtube';
            let badgeText = 'YouTube';
            if (item.source === 'lastfm') { badgeClass = 'source-badge--lastfm'; badgeText = 'Last.fm'; }
            if (item.source === 'soundcharts') { badgeClass = 'source-badge--soundcharts'; badgeText = 'SC'; }

            row.innerHTML = `
                <div class="track__drag-handle" title="Drag to reorder">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
                        <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
                    </svg>
                </div>
                <div class="track__number">${index + 1}</div>
                <img src="${item.image_url || 'static/images/default-album.png'}" alt="" class="track__image">
                <div class="track__info">
                    <div class="track__name-row">
                        <span class="track__name">${sanitizeHTML(item.track_name)}</span>
                        <span class="source-badge ${badgeClass}">${sanitizeHTML(badgeText)}</span>
                    </div>
                    <span class="track__artist">${sanitizeHTML(item.artist)}</span>
                </div>
                <div class="track__album hide-on-mobile">${sanitizeHTML(item.album_name || '-')}</div>
                <div class="track__duration">${durationStr}</div>
                <div class="track__actions">
                    ${window.IS_ADMIN ? `
                    <button class="track__download" title="Download MP3">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>` : ''}
                    <button class="track__remove" title="Remove track">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `;

            row.addEventListener('dragstart', handleDragStart);
            row.addEventListener('dragover', handleDragOver);
            row.addEventListener('drop', handleDrop);
            row.addEventListener('dragend', handleDragEnd);

            row.querySelector('.track__remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeTrack(item.id);
            });
            
            if (window.IS_ADMIN) {
                const downloadBtn = row.querySelector('.track__download');
                if (downloadBtn) {
                    downloadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.location.href = `api/playlist/download/${item.id}`;
                    });
                }
            }
            
            // Make track clickable to open source URL
            row.addEventListener('click', (e) => {
                if (e.target.closest('.track__remove') || e.target.closest('.track__drag-handle')) return;
                if (item.external_url) window.open(item.external_url, '_blank');
            });

            tracksContainer.appendChild(row);
        });

        updateStats();
    }

    function handleDragStart(e) {
        draggedItem = this;
        this.classList.add('track--dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDrop(e) {
        e.stopPropagation();
        if (draggedItem !== this) {
            const allTracks = [...tracksContainer.querySelectorAll('.track')];
            const fromIndex = parseInt(draggedItem.dataset.index);
            const toIndex = parseInt(this.dataset.index);

            const [movedItem] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, movedItem);

            renderPlaylist();
            saveOrder();
        }
        return false;
    }

    function handleDragEnd() {
        this.classList.remove('track--dragging');
        draggedItem = null;
    }

    async function removeTrack(itemId) {
        try {
            const resp = await fetch(`api/playlist/remove/${itemId}`, { 
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken()
                }
            });
            const data = await resp.json();
            if (data.success) {
                items = items.filter(i => i.id !== itemId);
                renderPlaylist();
                showToast(T.remove_from_playlist || 'Track removed', 'info');
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function saveOrder() {
        const track_ids = items.map(item => item.id);
        try {
            await fetch('api/playlist/reorder', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ 
                    playlist_id: activePlaylistId,
                    track_ids: track_ids 
                })
            });
        } catch (err) {
            console.error('Failed to save order:', err);
        }
    }

    function updateStats() {
        const totalTracks = items.length;
        const totalMs = items.reduce((sum, item) => sum + (item.duration_ms || 0), 0);
        const totalMins = Math.round(totalMs / 60000);

        if (totalTracksEl) {
            let tpl = T.total_tracks || '{count} tracks';
            totalTracksEl.textContent = tpl.replace('{count}', totalTracks);
        }
        if (totalDurationEl) {
            let tpl = T.total_duration || '{mins} min';
            totalDurationEl.textContent = tpl.replace('{mins}', totalMins);
        }
    }

    const clearBtn = document.getElementById('clear-playlist-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
            if (items.length === 0) return;
            if (confirm('Opravdu chcete smazat celý playlist? (Are you sure you want to clear the playlist?)')) {
                try {
                    const resp = await fetch(`api/playlist/clear/${activePlaylistId}`, {
                        method: 'POST',
                        headers: {
                            'X-CSRFToken': getCsrfToken()
                        }
                    });
                    const data = await resp.json();
                    if (data.success) {
                        items = [];
                        renderPlaylist();
                        showToast('Playlist cleared', 'info');
                    }
                } catch (err) {
                    console.error(err);
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
    fetchShareState();
});
