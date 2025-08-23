import * as maptilersdk from '@maptiler/sdk';

function backoffDelays(max = 5) {
    // 0.5s, 1s, 2s, 4s, 8s
    return Array.from({ length: max }, (_, i) => 500 * Math.pow(2, i));
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isTransientNetworkError(err) {
    const msg = (err && (err.message || err.toString())) || '';
    // Chrome error string or fetch TypeError
    return msg.includes('ERR_NETWORK_CHANGED') || msg.includes('Failed to fetch') || msg.includes('NetworkError');
}

export default function mapTilerPicker({ config }) {
    let map = null;
    let marker = null;
    let styles = null;
    const locales = {
        ar: {
            'NavigationControl.ZoomIn': 'تكبير',
            'NavigationControl.ZoomOut': 'تصغير',
            'NavigationControl.ResetBearing': 'إعادة الاتجاه إلى الشمال',
            'NavigationControl.RotateLeft': 'استدارة لليسار',
            'NavigationControl.RotateRight': 'استدارة لليمين',
            'NavigationControl.PitchUp': 'رفع الميل',
            'NavigationControl.PitchDown': 'خفض الميل',
        },
    };

    const S = () => Alpine.store('mt');

    return {
        lat: null,
        lng: null,
        config: {
            draggable: true,
            clickable: true,
            defaultZoom: 13,
            defaultLocation: { lat: 41.0082, lng: 28.9784 }, // ???
            searchLocationButtonLabel: '',
            statePath: '',
            style: 'STREETS',
            customTiles: [],
            customMarker: null,
            is_disabled: false,
            showStyleSwitcher: false,
            apiKey: '',
            style_text: 'Map Style',
            rotationable: true,
            hash: false,
            maxBounds: null,
            language: null,
            geolocate: false,
            zoomable: true,
        },

        init() {
            // ensure global store for teleported modal
            if (!Alpine.store('mt')) {
                Alpine.store('mt', {
                    searchQuery: '',
                    localSearchResults: [],
                    isSearching: false,
                    searchTimeout: null,
                });
            }

            this.config = { ...this.config, ...config };
            if (!this.config.apiKey) throw new Error('MapTiler API key is required');
            if (!window.__maptilerApiKey || window.__maptilerApiKey !== this.config.apiKey) {
                maptilersdk.config.apiKey = this.config.apiKey;
                window.__maptilerApiKey = this.config.apiKey;
            }
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                maptilersdk.config.primaryLanguage = lang;
            }

            styles = {
                STREETS: maptilersdk.MapStyle.STREETS,
                'STREETS.DARK': maptilersdk.MapStyle.STREETS.DARK,
                'STREETS.LIGHT': maptilersdk.MapStyle.STREETS.LIGHT,
                OUTDOOR: maptilersdk.MapStyle.OUTDOOR,
                WINTER: maptilersdk.MapStyle.WINTER,
                SATELLITE: maptilersdk.MapStyle.SATELLITE,
                HYBRID: maptilersdk.MapStyle.HYBRID,
                DATAVIZ: maptilersdk.MapStyle.DATAVIZ,
                'DATAVIZ.DARK': maptilersdk.MapStyle.DATAVIZ.DARK,
                'DATAVIZ.LIGHT': maptilersdk.MapStyle.DATAVIZ.LIGHT,
            };
            if (this.config.customTiles && Object.keys(this.config.customTiles).length > 0) {
                styles = { ...styles, ...this.config.customTiles };
            }

            this.initMap();
        },

        recreateMapInstance() {
            // Preserve state
            const center = marker ? marker.getLngLat() : null;
            const zoom = map ? map.getZoom() : this.config.defaultZoom;
            const styleName = this.config.style;

            // Clean up old instance
            try {
                map && map.remove();
            } catch (_) {}
            map = null;
            marker = null;

            // Re-init
            this.initMap();

            // Restore state
            if (center) {
                map.setCenter([center.lng, center.lat]);
                map.setZoom(zoom);
                marker.setLngLat([center.lng, center.lat]);
            }
            // Ensure style stays what user picked
            if (styleName) this.setStyle(styleName);
        },

        async tryReloadStyleWithBackoff() {
            const delays = backoffDelays(5);
            for (let i = 0; i < delays.length; i++) {
                try {
                    // Force a style re-apply triggers a fresh style.json fetch
                    const style = styles[this.config.style] || maptilersdk.MapStyle.STREETS;
                    map.setStyle(style);
                    // wait until style is actually loaded or throws
                    await new Promise((resolve, reject) => {
                        const onError = (e) => reject(e && e.error ? e.error : new Error('style error'));
                        const onStyle = () => {
                            map.off('error', onError);
                            resolve();
                        };
                        map.once('styledata', onStyle);
                        map.once('error', onError);
                    });
                    return true; // success
                } catch (err) {
                    // only backoff for transient errors; otherwise bail early
                    if (!isTransientNetworkError(err)) break;
                    await sleep(delays[i]);
                }
            }
            return false;
        },

        hardRefreshSoon() {
            // Avoid thrashing: only refresh when tab is visible & online
            if (document.visibilityState !== 'visible') return;
            if (!navigator.onLine) return;
            this.recreateMapInstance();
        },

        initMap() {
            const initial = { ...this.getCoordinates() };
            const center = [initial.lng, initial.lat];

            const mapOptions = {
                container: this.$refs.mapContainer,
                style: styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: this.config.defaultZoom,
                navigationControl: false,
                geolocateControl: false,
                terrainControl: false,
                scaleControl: false,
                fullscreenControl: false,
                projectionControl: false,
            };
            if (this.config.hash) mapOptions.hash = true;
            if (this.config.maxBounds) mapOptions.maxBounds = this.config.maxBounds;

            map = new maptilersdk.Map(mapOptions);

            // const ctrlContainer = map.getContainer().querySelector('.maplibregl-ctrl-top-right');
            // if (ctrlContainer) ctrlContainer.innerHTML = '';

            if (this.config.geolocate) {
                const geo = new maptilersdk.GeolocateControl({
                    trackUserLocation: true,
                    positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 },
                    fitBoundsOptions: { maxZoom: 15 },
                });
                map.addControl(geo, 'top-right');
                map.on('load', () => geo.trigger());
            }

            // map.addControl(
            //     new maptilersdk.MaptilerNavigationControl({
            //         showCompass: this.config.rotationable,
            //         showZoom: this.config.zoomable,
            //         visualizePitch: this.config.rotationable,
            //     }),
            //     'top-right'
            // );
            // Navigation: only add if it would display anything
            if (this.config.rotationable || this.config.zoomable) {
                map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: this.config.rotationable,
                        showZoom: this.config.zoomable,
                        visualizePitch: this.config.rotationable,
                    }),
                    'top-right'
                );
            }
            if (!this.config.rotationable) {
                map.dragRotate.disable();
                map.touchZoomRotate.disableRotation();
            }

            if (!this.config.zoomable) {
                map.scrollZoom.disable();
                map.boxZoom.disable();
                map.doubleClickZoom.disable();
                map.touchZoomRotate.disable();
                map.keyboard.disable();
            }

            // avoid empty sprite warning noise (harmless, but noisy)
            map.on('styleimagemissing', (e) => {
                if (!e.id || !e.id.trim()) return;
            });

            const opts = { draggable: this.config.draggable };
            if (this.config.customMarker) opts.element = this.createMarkerElement(this.config.customMarker);
            marker = new maptilersdk.Marker(opts).setLngLat(center).addTo(map);

            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            if (this.config.clickable) map.on('click', (e) => this.markerMoved({ latLng: e.lngLat }));
            if (this.config.draggable) marker.on('dragend', () => this.markerMoved({ latLng: marker.getLngLat() }));

            if (!this.config.is_disabled) {
                this.addSearchButton();
            }
            if (this.config.showStyleSwitcher) this.addStyleSwitcherControl();
            // Language: set once. If you also set config.primaryLanguage before map init,
            // there’s no need to call setLanguage() again unless you’re applying custom locales.
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                // Only apply setLanguage if we also have custom tooltips/locales to merge.
                if (locales[this.config.language]) {
                    map.on('load', () => {
                        map.setLanguage(lang);
                        map.setLocale(locales[this.config.language]);
                    });
                }
            } else if (locales[this.config.language]) {
                map.setLocale(locales[this.config.language]);
            }

            // If the WebGL context is lost (sleep/driver hiccup), prevent default and try to recover.
            map.on('webglcontextlost', (e) => {
                e.preventDefault(); // tell the browser we will recover
                // Light touch: try a style reload; if it fails, hard refresh
                this.tryReloadStyleWithBackoff().then((ok) => {
                    if (!ok) this.hardRefreshSoon();
                });
            });

            // Map/lib errors during style/source fetch: debounce + backoff retry or hard refresh.
            let errorTimer = null;
            map.on('error', (evt) => {
                const err = evt && evt.error;
                const transient = isTransientNetworkError(err);
                if (!transient) return; // don't loop on non-network errors
                if (errorTimer) clearTimeout(errorTimer);
                errorTimer = setTimeout(() => {
                    this.tryReloadStyleWithBackoff().then((ok) => {
                        if (!ok) this.hardRefreshSoon();
                    });
                }, 150); // small debounce to coalesce bursts
            });

            // When the user regains connectivity, try to reload style quickly.
            window.addEventListener('online', () => {
                this.tryReloadStyleWithBackoff().then((ok) => {
                    if (!ok) this.hardRefreshSoon();
                });
            });

            // When tab becomes visible after sleep, re-verify the map.
            document.addEventListener(
                'visibilitychange',
                () => {
                    if (document.visibilityState === 'visible') {
                        // attempt a gentle path first
                        this.tryReloadStyleWithBackoff().then((ok) => {
                            if (!ok) this.hardRefreshSoon();
                        });
                    }
                },
                { passive: true }
            );
        },

        // --- search helpers now use the store
        debounceSearch() {
            const st = S();
            if (st.searchTimeout) clearTimeout(st.searchTimeout);
            if (!st.searchQuery || st.searchQuery.length < 3) {
                st.localSearchResults = [];
                st.isSearching = false;
                return;
            }
            st.isSearching = true;
            st.searchTimeout = setTimeout(() => this.searchLocationFromModal(st.searchQuery), 500);
        },

        async searchLocationFromModal(query) {
            const st = S();
            if (!query || query.length < 3) {
                st.isSearching = false;
                return;
            }
            try {
                const results = await maptilersdk.geocoding.forward(query);
                st.localSearchResults = results.features;
            } catch (e) {
                console.error('Search error:', e);
            } finally {
                st.isSearching = false;
            }
        },

        selectLocationFromModal(result) {
            const [lng, lat] = result.center || result.geometry.coordinates;
            map.setCenter([lng, lat]);
            map.setZoom(15);
            marker.setLngLat([lng, lat]);
            this.lat = lat;
            this.lng = lng;

            const st = S();
            st.localSearchResults = [];
            st.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
        },

        setStyle(styleName) {
            this.config.style = styleName; // persist chosen style
            const style = styles[styleName] || maptilersdk.MapStyle.STREETS;
            try {
                map.setStyle(style);
            } catch (err) {
                // If called while context is flaky, schedule a hard refresh
                if (isTransientNetworkError(err)) {
                    this.hardRefreshSoon();
                } else {
                    console.error('setStyle failed:', err);
                }
            }
        },

        addSearchButton() {
            const self = this;
            class SearchControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.className = 'items-center';
                    btn.style.display = 'grid';
                    btn.style.justifyContent = 'center';
                    btn.type = 'button';
                    btn.innerHTML = [
                        '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">',
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/>',
                        '</svg>',
                    ].join('');
                    btn.title = self.config.searchLocationButtonLabel || 'Search Location';
                    btn.onclick = () => {
                        self.$dispatch('open-modal', { id: 'location-search-modal' });
                    };
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) {
                        this.container.parentNode.removeChild(this.container);
                    }
                    this.map = undefined;
                }
            }
            map.addControl(new SearchControl(), 'top-left');
        },

        addStyleSwitcherControl() {
            const self = this;
            class TileControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
                    const label = document.createElement('label');
                    label.textContent = self.config.style_text;
                    const select = document.createElement('select');
                    Object.keys(styles).forEach((key) => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = self.formatStyleName(key);
                        if (key === self.config.style) option.selected = true;
                        select.appendChild(option);
                    });
                    select.onchange = (e) => self.setStyle(e.target.value);
                    this.container.appendChild(label);
                    this.container.appendChild(select);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) {
                        this.container.parentNode.removeChild(this.container);
                    }
                    this.map = undefined;
                }
            }
            map.addControl(new TileControl(), 'top-right');
        },

        formatStyleName(name) {
            return name
                .replace(/\./g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (s) => s.toUpperCase())
                .trim();
        },

        markerMoved(event) {
            const position = event.latLng;
            this.lat = position.lat;
            this.lng = position.lng;
            this.setCoordinates({ lat: this.lat, lng: this.lng });
            marker.setLngLat([this.lng, this.lat]);
            map.easeTo({ center: [this.lng, this.lat] });
        },

        updateMapFromAlpine() {
            const location = this.getCoordinates();
            const pos = marker.getLngLat();
            if (location.lat !== pos.lat || location.lng !== pos.lng) {
                this.updateMap(location);
            }
        },

        updateMap(position) {
            marker.setLngLat([position.lng, position.lat]);
            map.easeTo({ center: [position.lng, position.lat] });
            this.lat = position.lat;
            this.lng = position.lng;
        },

        setCoordinates(position) {
            this.$wire.set(this.config.statePath, { lat: position.lat, lng: position.lng });
        },

        getCoordinates() {
            let location = this.$wire.get(this.config.statePath);
            if (!location || !location.lat || !location.lng) {
                location = { lat: this.config.defaultLocation.lat, lng: this.config.defaultLocation.lng };
            }
            return { lat: location.lat, lng: location.lng };
        },
    };
}
