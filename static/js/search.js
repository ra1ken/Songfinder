document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.querySelector('.search');
    const searchInput = document.getElementById('search-input');

    const filtersSection = document.getElementById('filters-section');
    const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
    const filtersPanel = document.getElementById('filters-panel');
    const sortSelect = document.getElementById('sort-select');
    const limitSelect = document.getElementById('limit-select');
    const filterText = document.getElementById('filter-text');
    const filterGenreContainer = document.getElementById('filter-genre-tags');
    const filterYearMin = document.getElementById('filter-year-min');
    const filterYearMax = document.getElementById('filter-year-max');
    const filterPopularity = document.getElementById('filter-popularity');
    const filterExplicit = document.getElementById('filter-explicit');
    const resultsCount = document.getElementById('results-count');

    const apiToggle = document.getElementById('api-toggle');
    const similarOverlay = document.getElementById('similar-modal-overlay');
    const similarClose = document.getElementById('similar-modal-close');

    let allResults = [];
    let currentSource = 'spotify';
    let activeFilters = {
        text: '',
        genres: new Set(),
        yearMin: null,
        yearMax: null,
        popularity: 0,
        hideExplicit: false
    };
    let currentSort = 'relevance';

    if (apiToggle) {
        apiToggle.querySelectorAll('.api-toggle__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                apiToggle.querySelector('.api-toggle__btn--active').classList.remove('api-toggle__btn--active');
                btn.classList.add('api-toggle__btn--active');
                currentSource = btn.dataset.source;
                if (searchInput.value.trim()) {
                    searchForm.dispatchEvent(new Event('submit'));
                }
            });
        });
    }

    if (similarClose) {
        similarClose.addEventListener('click', closeSimilarModal);
    }
    if (similarOverlay) {
        similarOverlay.addEventListener('click', (e) => {
            if (e.target === similarOverlay) closeSimilarModal();
        });
    }

    function closeSimilarModal() {
        if (similarOverlay) similarOverlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    if (searchForm) {
        searchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = searchInput.value.trim();
            const limit = limitSelect ? limitSelect.value : 20;

            if (!query) return;

            const button = searchForm.querySelector('button');
            const originalText = button.textContent;
            button.textContent = window.SEARCH_TRANSLATIONS ? window.SEARCH_TRANSLATIONS.searching : 'Searching...';
            button.disabled = true;

            try {
                if (filtersSection) filtersSection.style.display = 'none';

                const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}&source=${currentSource}`);

                if (!response.ok) {
                    try {
                        const errData = await response.json();
                        throw new Error(errData.error || 'Search failed');
                    } catch(e) {
                         throw new Error(e.message || 'Search failed');
                    }
                }

                const tracks = await response.json();

                allResults = tracks;

                initializeFilters(tracks);
                applyFiltersAndSort();

                if (filtersSection) {
                    filtersSection.style.display = 'block';
                    filtersSection.scrollIntoView({ behavior: 'smooth' });
                }

            } catch (error) {
                console.error('Error:', error);
                
                let resultsContainer = document.querySelector('.features');
                if (resultsContainer) {
                    if (!resultsContainer.classList.contains('search-results-grid')) {
                         resultsContainer.className = 'features search-results-grid';
                    }
                    resultsContainer.innerHTML = `<p class="no-results" style="grid-column: 1/-1; text-align: center; color: var(--danger-color, #e74c3c); padding: 2rem; background: rgba(231, 76, 60, 0.1); border-radius: 8px; border: 1px solid var(--danger-color, #e74c3c);">${error.message}</p>`;
                } else {
                    alert(error.message || 'Chyba při vyhledávání. Zkuste to prosím znovu.');
                }
                
                if (resultsCount) resultsCount.textContent = '';
                
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        });
    }

    if (toggleFiltersBtn) {
        if (filtersPanel.style.display === '') filtersPanel.style.display = 'none';

        toggleFiltersBtn.addEventListener('click', () => {
            const isHidden = filtersPanel.style.display === 'none';
            filtersPanel.style.display = isHidden ? 'grid' : 'none';
        });
    }

    if (limitSelect) {
        limitSelect.addEventListener('change', () => {
            if (searchInput.value.trim()) {
                searchForm.dispatchEvent(new Event('submit'));
            }
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            applyFiltersAndSort();
        });
    }

    if (filterText) {
        filterText.addEventListener('input', (e) => {
            activeFilters.text = e.target.value.toLowerCase();
            applyFiltersAndSort();
        });
    }

    if (filterPopularity) {
        filterPopularity.addEventListener('change', (e) => {
            activeFilters.popularity = parseInt(e.target.value);
            applyFiltersAndSort();
        });
    }

    if (filterExplicit) {
        filterExplicit.addEventListener('change', (e) => {
            activeFilters.hideExplicit = e.target.checked;
            applyFiltersAndSort();
        });
    }

    [filterYearMin, filterYearMax].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                activeFilters.yearMin = filterYearMin.value ? parseInt(filterYearMin.value) : null;
                activeFilters.yearMax = filterYearMax.value ? parseInt(filterYearMax.value) : null;
                applyFiltersAndSort();
            });
        }
    });

    function initializeFilters(tracks) {
        const genres = new Set();
        tracks.forEach(track => {
            if (track.genres) {
                track.genres.forEach(g => genres.add(g));
            }
        });

        if (filterGenreContainer) {
            filterGenreContainer.innerHTML = '';

            Array.from(genres).sort().forEach(genre => {
                const id = `genre-${genre.replace(/\s+/g, '-')}`;
                const wrapper = document.createElement('div');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = id;
                checkbox.className = 'filter-tag-check';
                checkbox.value = genre;

                const label = document.createElement('label');
                label.htmlFor = id;
                label.className = 'filter-tag-label';
                label.textContent = genre;

                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        activeFilters.genres.add(genre);
                    } else {
                        activeFilters.genres.delete(genre);
                    }
                    applyFiltersAndSort();
                });

                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                filterGenreContainer.appendChild(wrapper);
            });
        }
    }

    function getPopularityScore(track) {
        if (track.source === 'spotify') return track.popularity || 0;
        if (track.source === 'lastfm') {
            const l = track.listeners || 0;
            if (l >= 2000000) return 90;
            if (l >= 500000) return 70;
            if (l >= 100000) return 50;
            if (l >= 10000) return 30;
            return 10;
        }
        return 0;
    }

    function applyFiltersAndSort() {
        let results = [...allResults];

        results = results.filter(track => {
            if (activeFilters.text) {
                const match =
                    track.name.toLowerCase().includes(activeFilters.text) ||
                    track.artist.toLowerCase().includes(activeFilters.text) ||
                    (track.album && track.album.toLowerCase().includes(activeFilters.text));
                if (!match) return false;
            }

            if (activeFilters.genres.size > 0) {
                if (!track.genres || !track.genres.some(g => activeFilters.genres.has(g))) {
                    return false;
                }
            }

            const year = track.release_date ? parseInt(track.release_date.substring(0, 4)) : null;
            if (year) {
                if (activeFilters.yearMin && year < activeFilters.yearMin) return false;
                if (activeFilters.yearMax && year > activeFilters.yearMax) return false;
            }

            const pop = getPopularityScore(track);
            if (pop < activeFilters.popularity) return false;

            if (activeFilters.hideExplicit && track.explicit) return false;

            return true;
        });

        results.sort((a, b) => {
            switch (currentSort) {
                case 'name_asc': return a.name.localeCompare(b.name);
                case 'name_desc': return b.name.localeCompare(a.name);
                case 'artist_asc': return a.artist.localeCompare(b.artist);
                case 'artist_desc': return b.artist.localeCompare(a.artist);
                case 'year_desc':
                    return (b.release_date || '').localeCompare(a.release_date || '');
                case 'year_asc':
                    return (a.release_date || '').localeCompare(b.release_date || '');
                case 'popularity_desc':
                    return getPopularityScore(b) - getPopularityScore(a);
                case 'popularity_asc':
                    return getPopularityScore(a) - getPopularityScore(b);
                default: return 0;
            }
        });

        displayResults(results);
        updateCount(results.length, allResults.length);
    }

    function updateCount(shown, total) {
        if (resultsCount && window.SEARCH_TRANSLATIONS) {
            let msg = window.SEARCH_TRANSLATIONS.showing_results;
            msg = msg.replace('{shown}', shown).replace('{total}', total);
            resultsCount.textContent = msg;
        } else if (resultsCount) {
            resultsCount.textContent = `Showing ${shown} of ${total} songs`;
        }
    }
});

function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

function displayResults(results) {
    let resultsContainer = document.querySelector('.features');

    if (!resultsContainer) {
        console.error('Features container not found');
        return;
    }

    if (!resultsContainer.classList.contains('search-results-grid')) {
        resultsContainer.className = 'features search-results-grid';
    }

    if (results.length === 0) {
        const msg = window.SEARCH_TRANSLATIONS ? window.SEARCH_TRANSLATIONS.no_results : 'No results found.';
        resultsContainer.innerHTML = `<p class="no-results" style="grid-column: 1/-1; text-align: center;">${msg}</p>`;
        return;
    }

    resultsContainer.innerHTML = '';

    const T = window.SEARCH_TRANSLATIONS || {};

    results.forEach(track => {
        const card = document.createElement('article');
        card.className = 'feature-card result-card';
        card.style.textAlign = 'left';

        const genresHtml = track.genres && track.genres.length > 0
            ? `<div class="result-card__genres">${track.genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>`
            : '';

        const audioHtml = track.preview_url
            ? `<audio controls class="result-card__audio">
           <source src="${track.preview_url}" type="audio/mpeg">
         </audio>`
            : '';

        const explicitHtml = track.explicit
            ? '<span title="Explicit Content" style="color: red; border: 1px solid red; border-radius: 4px; padding: 0 4px; font-size: 10px; margin-left: 5px;">E</span>'
            : '';

        let sourceBadgeClass = 'source-badge--spotify';
        let sourceBadgeText = 'Spotify';
        if (track.source === 'lastfm') {
            sourceBadgeClass = 'source-badge--lastfm';
            sourceBadgeText = 'Last.fm';
        } else if (track.source === 'soundcharts') {
            sourceBadgeClass = 'source-badge--soundcharts';
            sourceBadgeText = 'Soundcharts';
        }
        const sourceBadge = `<span class="source-badge ${sourceBadgeClass}">${sourceBadgeText}</span>`;

        let statsHtml = '';
        if (track.source === 'spotify') {
            statsHtml = `<div class="result-card__stats"><span>🔥 ${track.popularity}%</span></div>`;
        } else if (track.source === 'lastfm' && (track.listeners || track.playcount)) {
            statsHtml = `<div class="result-card__stats">`;
            if (track.listeners) statsHtml += `<span title="${T.listeners || 'Listeners'}">👥 ${formatNumber(track.listeners)}</span>`;
            if (track.playcount) statsHtml += `<span title="${T.playcount || 'Playcount'}">▶ ${formatNumber(track.playcount)}</span>`;
            statsHtml += `</div>`;
        } else if (track.source === 'soundcharts' && track.audio_features) {
            const af = track.audio_features;
            statsHtml = `<div class="result-card__stats">`;
            if (af.energy) statsHtml += `<span title="Energy">⚡ ${af.energy}%</span>`;
            if (af.danceability) statsHtml += `<span title="Danceability">💃 ${af.danceability}%</span>`;
            if (af.bpm) statsHtml += `<span title="BPM">🥁 ${Math.round(af.bpm)}</span>`;
            statsHtml += `</div>`;
        }

        const metaLine = track.release_date
            ? track.release_date.substring(0, 4) + (track.album ? ' • ' + track.album : '')
            : (track.album || '');

        const openUrl = track.external_url || '#';
        let openLabel = 'Spotify';
        if (track.source === 'lastfm') openLabel = 'Last.fm';
        if (track.source === 'soundcharts') openLabel = 'Soundcharts';

        card.innerHTML = `
      <div class="result-card__image-wrapper">
        <img src="${track.image || 'static/images/default-album.png'}" alt="${track.album || track.name}" class="result-card__image">
      </div>
      <div class="result-card__content">
        <div class="result-card__header-row">
          <h3 class="result-card__title" title="${track.name}">${track.name} ${explicitHtml}</h3>
          ${sourceBadge}
        </div>
        <p class="result-card__artist" title="${track.artist}">${track.artist}</p>
        <p class="result-card__meta" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">
            ${metaLine}
        </p>
        ${statsHtml}
        ${genresHtml}
        ${audioHtml}
        <div class="result-card__actions">
          <button class="btn btn--primary btn--sm result-card__add-btn" onclick="window.open('${openUrl}', '_blank')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
            </svg>
            ${openLabel}
          </button>
          <button class="btn btn--secondary btn--sm result-card__playlist-btn" data-track='${JSON.stringify(track).replace(/'/g, "&#39;")}'>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            ${T.add_to_playlist || 'Playlist'}
          </button>
          <button class="btn btn--secondary btn--sm result-card__similar-btn" data-artist="${track.artist}" data-track="${track.name}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 12h8M12 8v8"></path>
            </svg>
            ${T.similar_btn || 'Similar'}
          </button>
        </div>
      </div>
    `;

        resultsContainer.appendChild(card);
    });

    document.querySelectorAll('.result-card__playlist-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const trackData = JSON.parse(btn.dataset.track);
                const resp = await fetch('/api/playlist/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(trackData)
                });
                const data = await resp.json();
                if (data.success) {
                    btn.textContent = '✓';
                    btn.disabled = true;
                    btn.style.opacity = '0.6';
                } else if (resp.status === 401) {
                    alert(T.export_login_required || 'Please log in to add songs to playlist.');
                }
            } catch (err) {
                console.error(err);
            }
        });
    });

    document.querySelectorAll('.result-card__similar-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            openSimilarModal(btn.dataset.artist, btn.dataset.track);
        });
    });
}

async function openSimilarModal(artist, track) {
    const overlay = document.getElementById('similar-modal-overlay');
    const title = document.getElementById('similar-modal-title');
    const body = document.getElementById('similar-modal-body');
    const T = window.SEARCH_TRANSLATIONS || {};

    if (!overlay) return;

    title.textContent = `${T.similar_tracks || 'Similar Tracks'}: ${track} — ${artist}`;
    body.innerHTML = `<p class="similar-loading">${T.loading_similar || 'Loading...'}</p>`;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const resp = await fetch(`/api/track/similar?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`);
        const data = await resp.json();

        if (!data || data.length === 0) {
            body.innerHTML = `<p class="similar-empty">${T.no_similar || 'No similar tracks found.'}</p>`;
            return;
        }

        body.innerHTML = '';
        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'similar-card';
            card.innerHTML = `
                <img src="${item.image || 'static/images/default-album.png'}" alt="${item.name}" class="similar-card__img">
                <div class="similar-card__info">
                    <span class="similar-card__name">${item.name}</span>
                    <span class="similar-card__artist">${item.artist}</span>
                    <span class="similar-card__match">${item.match}% match</span>
                </div>
                <a href="${item.url}" target="_blank" class="similar-card__link">Last.fm ↗</a>
            `;
            body.appendChild(card);
        });
    } catch (err) {
        body.innerHTML = `<p class="similar-empty">Error loading similar tracks.</p>`;
        console.error(err);
    }
}
