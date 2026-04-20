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
    const yearMinVal = document.getElementById('year-min-val');
    const yearMaxVal = document.getElementById('year-max-val');
    const yearSliderFill = document.getElementById('year-slider-fill');
    const filterPopularity = document.getElementById('filter-popularity');
    const filterExplicit = document.getElementById('filter-explicit');
    const resultsCount = document.getElementById('results-count');
    const resultsContainer = document.querySelector('.search-results-grid') || document.querySelector('.features');
    const genreFilterGroup = filterGenreContainer ? filterGenreContainer.closest('.filter-group') : null;
    const yearFilterGroup = filterYearMin ? filterYearMin.closest('.filter-group') : null;
    const popularityFilterGroup = filterPopularity ? filterPopularity.closest('.filter-group') : null;
    const explicitFilterGroup = filterExplicit ? filterExplicit.closest('.filter-group') : null;

    const apiToggle = document.getElementById('api-toggle');
    const similarOverlay = document.getElementById('similar-modal-overlay');
    const similarClose = document.getElementById('similar-modal-close');

    let allResults = [];
    let currentSource = 'youtube';
    const urlParams = new URLSearchParams(window.location.search);
    const initialQuery = (urlParams.get('query') || urlParams.get('q') || '').trim();
    const initialSource = (urlParams.get('source') || '').trim().toLowerCase();
    const defaultYearMin = filterYearMin ? parseInt(filterYearMin.min || '1900', 10) : 1900;
    const defaultYearMax = filterYearMax ? parseInt(filterYearMax.max || '2030', 10) : 2030;
    let activeFilters = {
        text: '',
        genres: new Set(),
        yearMin: defaultYearMin,
        yearMax: defaultYearMax,
        popularity: 0,
        hideExplicit: false
    };
    let currentSort = 'relevance';
    let searchAbortController = null;
    let searchRequestToken = 0;

    async function runSearch() {
        if (!searchInput) return;

        const query = searchInput.value.trim();
        const limit = limitSelect ? limitSelect.value : 20;
        if (!query) return;

        const token = ++searchRequestToken;

        if (searchAbortController) {
            searchAbortController.abort();
        }
        const controller = new AbortController();
        searchAbortController = controller;

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('query', query);
        nextUrl.searchParams.set('source', currentSource);
        window.history.replaceState({}, '', `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`);

        const button = searchForm ? searchForm.querySelector('button[type="submit"]') : null;
        const originalText = button ? button.textContent : '';
        if (button) {
            button.textContent = window.SEARCH_TRANSLATIONS ? window.SEARCH_TRANSLATIONS.searching : 'Searching...';
            button.disabled = true;
        }

        try {
            const response = await fetch(
                `api/search?q=${encodeURIComponent(query)}&limit=${limit}&source=${currentSource}`,
                { signal: controller.signal }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Search failed');
            }

            const tracks = await response.json();
            if (token !== searchRequestToken) return;

            allResults = Array.isArray(tracks) ? tracks : [];
            updateFilterAvailability(allResults);
            initializeFilters(allResults);
            applyFiltersAndSort();

            if (filtersSection) {
                filtersSection.style.display = 'block';
            }
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
            if (token !== searchRequestToken) return;

            console.error('Error:', error);
            if (resultsContainer) {
                resultsContainer.innerHTML = `<p class="no-results" style="grid-column: 1/-1; text-align: center; color: var(--danger, #e74c3c); padding: 2rem; background: rgba(231, 76, 60, 0.1); border-radius: 8px; border: 1px solid var(--danger, #e74c3c);">${sanitizeHTML(error.message)}</p>`;
            }
        } finally {
            if (searchAbortController === controller) {
                searchAbortController = null;
            }
            if (button && token === searchRequestToken) {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
    }

    if (apiToggle) {
        apiToggle.querySelectorAll('.api-toggle__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const active = apiToggle.querySelector('.api-toggle__btn--active');
                if (active) active.classList.remove('api-toggle__btn--active');
                btn.classList.add('api-toggle__btn--active');
                currentSource = btn.dataset.source;
                if (searchForm && searchInput && searchInput.value.trim()) {
                    runSearch();
                }
            });
        });
    }

    if (searchInput && initialQuery) {
        searchInput.value = initialQuery;
    }

    if (apiToggle && initialSource) {
        const sourceBtn = apiToggle.querySelector(`.api-toggle__btn[data-source="${initialSource}"]`);
        if (sourceBtn) {
            const active = apiToggle.querySelector('.api-toggle__btn--active');
            if (active) active.classList.remove('api-toggle__btn--active');
            sourceBtn.classList.add('api-toggle__btn--active');
            currentSource = initialSource;
        }
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
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            runSearch();
        });
    }

    function applyFiltersAndSort() {
        let results = [...allResults];

        results = results.filter(track => {
            if (activeFilters.text) {
                const match =
                    (track.name && track.name.toLowerCase().includes(activeFilters.text)) ||
                    (track.artist && track.artist.toLowerCase().includes(activeFilters.text)) ||
                    (track.album && track.album.toLowerCase().includes(activeFilters.text));
                if (!match) return false;
            }

            if (activeFilters.genres.size > 0) {
                if (!track.genres || !track.genres.some(g => activeFilters.genres.has(g))) {
                    return false;
                }
            }

            const pop = getPopularityScore(track);
            if (activeFilters.popularity > 0 && pop < activeFilters.popularity) return false;
            if (activeFilters.hideExplicit && track.explicit) return false;

            const hasYearFilter = activeFilters.yearMin > defaultYearMin || activeFilters.yearMax < defaultYearMax;
            if (hasYearFilter) {
                const year = getTrackYear(track);
                if (!year || year < activeFilters.yearMin || year > activeFilters.yearMax) {
                    return false;
                }
            }

            return true;
        });

        results.sort((a, b) => {
            switch (currentSort) {
                case 'name_asc': return (a.name || '').localeCompare(b.name || '');
                case 'name_desc': return (b.name || '').localeCompare(a.name || '');
                case 'artist_asc': return (a.artist || '').localeCompare(b.artist || '');
                case 'artist_desc': return (b.artist || '').localeCompare(a.artist || '');
                case 'year_desc': return getTrackYear(b) - getTrackYear(a);
                case 'year_asc': return getTrackYear(a) - getTrackYear(b);
                case 'popularity_desc': return getPopularityScore(b) - getPopularityScore(a);
                case 'popularity_asc': return getPopularityScore(a) - getPopularityScore(b);
                default: return 0;
            }
        });

        displayResults(results);
        updateCount(results.length, allResults.length);
    }

    function displayResults(results) {
        if (!resultsContainer) return;

        resultsContainer.innerHTML = '';
        if (!resultsContainer.classList.contains('search-results-grid')) {
            resultsContainer.classList.add('search-results-grid');
        }

        if (results.length === 0) {
            const msg = (window.SEARCH_TRANSLATIONS && window.SEARCH_TRANSLATIONS.no_results) || 'No results found.';
            resultsContainer.innerHTML = `<p class="no-results" style="grid-column: 1/-1; text-align: center;">${sanitizeHTML(msg)}</p>`;
            return;
        }

        const isAdmin = !!window.IS_ADMIN;

        results.forEach(track => {
            const card = document.createElement('article');
            card.className = 'feature-card result-card';

            let badgeClass = 'source-badge--youtube';
            if (track.source === 'lastfm') badgeClass = 'source-badge--lastfm';
            if (track.source === 'soundcharts') badgeClass = 'source-badge--soundcharts';

            card.innerHTML = `
                <div class="result-card__image-wrapper">
                    <img src="${track.image || 'static/images/default-album.png'}" alt="" class="result-card__image">
                </div>
                <div class="result-card__content">
                    <div class="result-card__header-row">
                        <h3 class="result-card__title">${sanitizeHTML(track.name)}</h3>
                        <span class="source-badge ${badgeClass}">${sanitizeHTML(track.source)}</span>
                    </div>
                    <p class="result-card__artist">${sanitizeHTML(track.artist)}</p>
                    <div class="result-card__actions">
                        <button class="btn btn--primary btn--sm result-card__play-btn">Play</button>
                        <button class="btn btn--secondary btn--sm result-card__add-btn">Add</button>
                        ${isAdmin ? `
                        <button class="btn btn--secondary btn--sm result-card__download-btn" title="Download MP3">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>` : ''}
                    </div>
                </div>
            `;

            const playBtn = card.querySelector('.result-card__play-btn');
            if (playBtn) playBtn.onclick = () => window.open(track.external_url, '_blank');

            if (isAdmin) {
                const downloadBtn = card.querySelector('.result-card__download-btn');
                if (downloadBtn) {
                    downloadBtn.onclick = async (e) => {
                        const btn = e.currentTarget;
                        const originalContent = btn.innerHTML;
                        btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></span>';
                        btn.disabled = true;

                        try {
                            let ytId = track.source === 'youtube' ? track.id : '';
                            if (!ytId) {
                                const searchRes = await fetch(`api/search?q=${encodeURIComponent(track.name + ' ' + track.artist)}&limit=1&source=youtube`);
                                const data = await searchRes.json();
                                if (data && data.length > 0 && data[0].id) {
                                    ytId = data[0].id;
                                }
                            }
                            if (ytId) {
                                window.location.href = `api/download/${ytId}`;
                            } else {
                                alert('Could not find a downloadable source for this track.');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Error resolving download link.');
                        } finally {
                            btn.innerHTML = originalContent;
                            btn.disabled = false;
                        }
                    };
                }
            }

            const addBtn = card.querySelector('.result-card__add-btn');
            if (addBtn) {
                addBtn.onclick = async (e) => {
                    const btn = e.currentTarget;
                    try {
                        const csrfToken = document.querySelector('meta[name="csrf-token"]');
                        const resp = await fetch('api/playlist/add', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRFToken': csrfToken ? csrfToken.getAttribute('content') : ''
                            },
                            body: JSON.stringify(track)
                        });
                        const data = await resp.json();
                        if (data.success) {
                            btn.textContent = '✓';
                            btn.disabled = true;
                        }
                    } catch (err) {
                        console.error(err);
                    }
                };
            }

            resultsContainer.appendChild(card);
        });
    }

    function updateCount(shown, total) {
        if (resultsCount) {
            if (window.SEARCH_TRANSLATIONS && window.SEARCH_TRANSLATIONS.showing_results) {
                let msg = window.SEARCH_TRANSLATIONS.showing_results;
                resultsCount.textContent = msg.replace('{shown}', shown).replace('{total}', total);
            } else {
                resultsCount.textContent = `Showing ${shown} of ${total} songs`;
            }
        }
    }

    function initializeFilters(tracks) {
        activeFilters.genres.clear();
        const genres = new Set();
        tracks.forEach(track => {
            if (!track.genres || !Array.isArray(track.genres)) return;
            track.genres.forEach((g) => {
                const normalized = String(g || '').trim();
                if (normalized) genres.add(normalized);
            });
        });

        if (filterGenreContainer) {
            filterGenreContainer.innerHTML = '';
            if (genres.size === 0) {
                const noGenresText = (window.SEARCH_TRANSLATIONS && window.SEARCH_TRANSLATIONS.no_genres_available) || 'No genres in current results.';
                filterGenreContainer.innerHTML = `<span class="text-muted">${sanitizeHTML(noGenresText)}</span>`;
                return;
            }
            Array.from(genres).sort().forEach(genre => {
                const id = `genre-${genre.replace(/\s+/g, '-')}`;
                const wrapper = document.createElement('div');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = id;
                checkbox.value = genre;
                checkbox.className = 'filter-tag-check';
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) activeFilters.genres.add(genre);
                    else activeFilters.genres.delete(genre);
                    applyFiltersAndSort();
                });
                const label = document.createElement('label');
                label.htmlFor = id;
                label.textContent = genre;
                label.className = 'filter-tag-label';
                wrapper.appendChild(checkbox);
                wrapper.appendChild(label);
                filterGenreContainer.appendChild(wrapper);
            });
        }
    }

    function updateFilterAvailability(tracks) {
        const hasGenres = tracks.some((track) => (
            Array.isArray(track.genres) &&
            track.genres.some((g) => String(g || '').trim().length > 0)
        ));
        const hasYear = tracks.some((track) => getTrackYear(track) > 0);
        const hasPopularity = tracks.some((track) => getPopularityScore(track) > 0);
        const hasExplicit = tracks.some((track) => !!track.explicit);

        if (!hasGenres) {
            activeFilters.genres.clear();
        }
        if (!hasYear) {
            activeFilters.yearMin = defaultYearMin;
            activeFilters.yearMax = defaultYearMax;
            if (filterYearMin) filterYearMin.value = String(defaultYearMin);
            if (filterYearMax) filterYearMax.value = String(defaultYearMax);
            updateYearFilterUI();
        }
        if (!hasPopularity) {
            activeFilters.popularity = 0;
            if (filterPopularity) filterPopularity.value = '0';
        }
        if (!hasExplicit) {
            activeFilters.hideExplicit = false;
            if (filterExplicit) filterExplicit.checked = false;
        }

        setFilterGroupVisibility(genreFilterGroup, hasGenres);
        setFilterGroupVisibility(yearFilterGroup, hasYear);
        setFilterGroupVisibility(popularityFilterGroup, hasPopularity);
        setFilterGroupVisibility(explicitFilterGroup, hasExplicit);
        setSortOptionAvailability(hasYear, hasPopularity);
    }

    function setFilterGroupVisibility(groupEl, isVisible) {
        if (!groupEl) return;
        groupEl.style.display = isVisible ? '' : 'none';
    }

    function setSortOptionAvailability(hasYear, hasPopularity) {
        if (!sortSelect) return;

        const updateOption = (value, enabled) => {
            const option = sortSelect.querySelector(`option[value="${value}"]`);
            if (!option) return;
            option.disabled = !enabled;
            option.hidden = !enabled;
        };

        updateOption('year_desc', hasYear);
        updateOption('year_asc', hasYear);
        updateOption('popularity_desc', hasPopularity);
        updateOption('popularity_asc', hasPopularity);

        if ((!hasYear && currentSort.startsWith('year_')) || (!hasPopularity && currentSort.startsWith('popularity_'))) {
            currentSort = 'relevance';
            sortSelect.value = 'relevance';
        }
    }

    function getTrackYear(track) {
        const fromTrack = Number(track && track.year);
        if (Number.isFinite(fromTrack) && fromTrack >= 1900 && fromTrack <= 2100) {
            return fromTrack;
        }
        const releaseDate = (track && track.release_date) || '';
        const match = String(releaseDate).match(/\b(19|20)\d{2}\b/);
        if (match) {
            return parseInt(match[0], 10);
        }
        return 0;
    }

    function getPopularityScore(track) {
        const explicitPopularity = Number(track && track.popularity);
        if (Number.isFinite(explicitPopularity) && explicitPopularity > 0) {
            return Math.max(0, Math.min(100, explicitPopularity));
        }

        const listeners = Number(track && track.listeners) || 0;
        const playcount = Number(track && track.playcount) || 0;
        const maxSignal = Math.max(listeners, playcount);
        if (maxSignal <= 0) return 0;

        // logarithmic scale for APIs with large listener/playcount numbers
        const scaled = Math.round(Math.min(100, Math.log10(maxSignal + 1) * 14));
        if (scaled > 0) return scaled;

        if (track.source === 'lastfm') return 20;
        return 0;
    }

    function updateYearFilterUI() {
        if (!filterYearMin || !filterYearMax) return;

        let minVal = parseInt(filterYearMin.value, 10);
        let maxVal = parseInt(filterYearMax.value, 10);
        if (Number.isNaN(minVal)) minVal = defaultYearMin;
        if (Number.isNaN(maxVal)) maxVal = defaultYearMax;

        if (minVal > maxVal) {
            if (document.activeElement === filterYearMin) {
                maxVal = minVal;
                filterYearMax.value = String(maxVal);
            } else {
                minVal = maxVal;
                filterYearMin.value = String(minVal);
            }
        }

        activeFilters.yearMin = minVal;
        activeFilters.yearMax = maxVal;

        if (yearMinVal) yearMinVal.textContent = String(minVal);
        if (yearMaxVal) yearMaxVal.textContent = String(maxVal);

        if (yearSliderFill) {
            const sliderMin = parseInt(filterYearMin.min || String(defaultYearMin), 10);
            const sliderMax = parseInt(filterYearMax.max || String(defaultYearMax), 10);
            const span = Math.max(1, sliderMax - sliderMin);
            const leftPct = ((minVal - sliderMin) / span) * 100;
            const rightPct = ((maxVal - sliderMin) / span) * 100;
            yearSliderFill.style.left = `${leftPct}%`;
            yearSliderFill.style.width = `${Math.max(0, rightPct - leftPct)}%`;
        }
    }

    function sanitizeHTML(str) {
        if (!str) return '';
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    // Modal logic
    if (toggleFiltersBtn) {
        toggleFiltersBtn.addEventListener('click', () => {
            const isHidden = filtersPanel.style.display === 'none' || filtersPanel.style.display === '';
            filtersPanel.style.display = isHidden ? 'grid' : 'none';
        });
    }

    if (limitSelect) {
        limitSelect.addEventListener('change', () => {
            if (searchInput && searchInput.value.trim()) {
                runSearch();
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
            const value = parseInt(e.target.value, 10);
            activeFilters.popularity = Number.isNaN(value) ? 0 : value;
            applyFiltersAndSort();
        });
    }

    if (filterExplicit) {
        filterExplicit.addEventListener('change', (e) => {
            activeFilters.hideExplicit = !!e.target.checked;
            applyFiltersAndSort();
        });
    }

    if (filterYearMin && filterYearMax) {
        const onYearChange = () => {
            updateYearFilterUI();
            applyFiltersAndSort();
        };
        filterYearMin.addEventListener('input', onYearChange);
        filterYearMax.addEventListener('input', onYearChange);
        filterYearMin.addEventListener('change', onYearChange);
        filterYearMax.addEventListener('change', onYearChange);
        updateYearFilterUI();
    }

    if (searchForm && searchInput && searchInput.value.trim()) {
        runSearch();
    }
});

async function openSimilarModal(artist, track) {
    const overlay = document.getElementById('similar-modal-overlay');
    const title = document.getElementById('similar-modal-title');
    const body = document.getElementById('similar-modal-body');
    const T = window.SEARCH_TRANSLATIONS || {};

    if (!overlay) return;

    title.textContent = `${T.similar_tracks || 'Similar Tracks'}: ${track} — ${artist}`;
    body.innerHTML = `<p class="similar-loading">${(T.loading_similar || 'Loading...')}</p>`;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    try {
        const resp = await fetch(`api/track/similar?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`);
        const data = await resp.json();

        if (!data || data.length === 0) {
            body.innerHTML = `<p class="similar-empty">${(T.no_similar || 'No similar tracks found.')}</p>`;
            return;
        }

        body.innerHTML = '';
        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'similar-card';
            card.innerHTML = `
                <img src="${item.image || 'static/images/default-album.png'}" alt="" class="similar-card__img">
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
