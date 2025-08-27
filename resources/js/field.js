import * as maptilersdk from '@maptiler/sdk';
import { throttle } from './helpers.js';
import {
    buildStyles,
    setupSdk,
    createLock,
    createLimiters,
    createMarkerElement,
    addGeolocateControl,
    hookNavButtons,
    hookInteractionGuards,
    addStyleSwitcherControl,
    addSatelliteToggleControl,
    attachWebglFailureProtection,
    applyLocaleIfNeeded,
    setStyle,
    hardRefreshSoon,
    recreateMapInstance,
} from './map-features.js';

export default function mapTilerPicker({ config }) {
    const cfg = config;
    setupSdk(cfg);

    const _styles = buildStyles(cfg.customStyles);
    const _limiters = createLimiters(cfg.rateLimits);
    let _map = null;
    let _marker = null;
    let _lock = createLock(cfg);

    return {
        lat: null,
        lng: null,
        commitCoordinates: null,
        config: cfg,
        lastFix: null,

        init() {
            if (!Alpine.store('mt')) {
                Alpine.store('mt', { searchQuery: '', localSearchResults: [], isSearching: false, searchTimeout: null });
            }

            this.initMap();
        },

        initMap() {
            const initial = { ...this.getCoordinates() };
            const center = [initial.lng, initial.lat];

            const mapOptions = {
                container: this.$refs.mapContainer,
                style: _styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: this.config.initialZoomLevel,
                minZoom: this.config.minZoomLevel ?? undefined,
                maxZoom: this.config.maxZoomLevel ?? undefined,
                navigationControl: false,
                geolocateControl: false,
                terrainControl: false,
                scaleControl: false,
                fullscreenControl: false,
                projectionControl: false,
                hash: !!this.config.hash,
                maxBounds: this.config.maxBounds || undefined,
            };

            _lock.initUI(this.$refs.mapContainer);
            _map = new maptilersdk.Map(mapOptions);
            _lock.attachMap(_map);

            const containerEl = _map.getCanvasContainer?.() || _map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, _map, _limiters, _lock);

            if (this.config.rotationable || this.config.zoomable) {
                _map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: this.config.rotationable,
                        showZoom: this.config.zoomable,
                        visualizePitch: this.config.rotationable,
                    }),
                    'top-right'
                );
                hookNavButtons(containerEl, _map, _limiters, _lock);
                _map.on('styledata', () => hookNavButtons(containerEl, _map, _limiters, _lock));
            }
            if (!this.config.rotationable) {
                _map.dragRotate.disable();
                _map.touchZoomRotate.disableRotation();
            }
            if (!this.config.zoomable) {
                _map.scrollZoom.disable();
                _map.boxZoom.disable();
                _map.doubleClickZoom.disable();
                _map.touchZoomRotate.disable();
                _map.keyboard.disable();
            }

            const geoCfg = this.config.geolocate;
            if (geoCfg.enabled) {
                addGeolocateControl(_map, containerEl, geoCfg, _limiters, _lock, {
                    onGeolocate: (e) => {
                        const { latitude, longitude, accuracy } = e.coords;
                        if (geoCfg.pinAsWell !== false) {
                            _marker.setLngLat([longitude, latitude]);
                            this.lat = latitude;
                            this.lng = longitude;
                            this.commitCoordinates({ lat: latitude, lng: longitude });
                        }
                        this.lastFix = {
                            lat: latitude,
                            lng: longitude,
                            accuracy: typeof accuracy === 'number' ? accuracy : null,
                            timestamp: Date.now(),
                        };
                    },
                    lastFix: () => this.lastFix,
                    jumpTo: (pos, opts) => this.jumpTo(pos, opts),
                });
            }

            let styleSelect;
            if (this.config.showStyleSwitcher) {
                styleSelect = addStyleSwitcherControl(
                    _map,
                    _styles,
                    this.config,
                    _lock,
                    (s) => this.setStyle(s)
                );
            }
            if (this.config.showSatelliteToggler) {
                addSatelliteToggleControl(
                    _map,
                    _styles,
                    this.config,
                    _lock,
                    styleSelect,
                    (s) => this.setStyle(s)
                );
            }

            _map.on('load', () => this.applyLocaleIfNeeded());
            _map.on('styledata', () => this.applyLocaleIfNeeded());
            attachWebglFailureProtection(_map, _styles, this.config, () => this.hardRefreshSoon());

            const markerOptions = { draggable: this.config.draggable };
            if (this.config.customMarker) {
                markerOptions.element = createMarkerElement(this.config.customMarker);
            }
            _marker = new maptilersdk.Marker(markerOptions).setLngLat(center).addTo(_map);

            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            if (this.config.clickable) {
                _map.on('click', (e) => {
                    if (_lock.isLocked()) return;
                    this.markerMoved({ latLng: e.lngLat });
                });
            }
            if (this.config.draggable) {
                _marker.on('dragend', () => {
                    if (_lock.isLocked()) return;
                    this.markerMoved({ latLng: _marker.getLngLat() });
                });
            }

            this.commitCoordinates = throttle((position) => {
                if (_lock.isLocked()) return;
                const t = _limiters.pinMove.try();
                if (t.ok) this.setCoordinates(position);
                else _lock.lockFor(t.resetMs);
            }, 300);

            this.addSearchButton();
        },

        setStyle,
        hardRefreshSoon,
        recreateMapInstance,
        applyLocaleIfNeeded,

        jumpTo(position, { zoom } = {}) {
            _marker.setLngLat([position.lng, position.lat]);
            if (typeof zoom === 'number') {
                _map.jumpTo({ center: [position.lng, position.lat], zoom });
            } else {
                _map.jumpTo({ center: [position.lng, position.lat] });
            }
            this.lat = position.lat;
            this.lng = position.lng;
        },

        markerMoved(event) {
            const p = event.latLng;
            this.lat = p.lat;
            this.lng = p.lng;
            this.commitCoordinates({ lat: this.lat, lng: this.lng });
            _marker.setLngLat([this.lng, this.lat]);
            _map.easeTo({ center: [this.lng, this.lat] });
        },

        updateMapFromAlpine() {
            const location = this.getCoordinates();
            const pos = _marker.getLngLat();
            if (location.lat !== pos.lat || location.lng !== pos.lng) this.updateMap(location);
        },

        updateMap(position) {
            _marker.setLngLat([position.lng, position.lat]);
            _map.easeTo({ center: [position.lng, position.lat] });
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

        debounceSearch() {
            const st = Alpine.store('mt');
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
            const st = Alpine.store('mt');
            if (!query || query.length < 3) {
                st.isSearching = false;
                return;
            }
            if (_lock.isLocked()) {
                st.isSearching = false;
                return;
            }
            const t = _limiters.search.try();
            if (!t.ok) {
                st.isSearching = false;
                _lock.lockFor(t.resetMs);
                this.$dispatch('close-modal', { id: 'location-search-modal' });
                return;
            }
            try {
                const results = await maptilersdk.geocoding.forward(query, {
                    language: this.config.language || 'en',
                });
                st.localSearchResults = results.features.map((f) => ({
                    ...f,
                    label: f.place_name || f.text || f.properties?.name || '',
                }));
            } catch (e) {
                console.error('Search error:', e);
            } finally {
                st.isSearching = false;
            }
        },

        selectLocationFromModal(result) {
            const [lng, lat] = result.center || result.geometry.coordinates;
            _map.setCenter([lng, lat]);
            _map.setZoom(15);
            _marker.setLngLat([lng, lat]);
            this.lat = lat;
            this.lng = lng;
            this.commitCoordinates({ lat, lng });
            const st = Alpine.store('mt');
            st.localSearchResults = [];
            st.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
        },

        addSearchButton() {
            const self = this;
            class SearchControl {
                onAdd(mp) {
                    _map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.className = 'items-center';
                    btn.style.display = 'grid';
                    btn.style.justifyContent = 'center';
                    btn.type = 'button';
                    btn.innerHTML =
                        '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>';
                    btn.title = self.config.searchLocationButtonLabel || 'Search Location';
                    btn.onclick = () => {
                        if (!_lock.isLocked()) self.$dispatch('open-modal', { id: 'location-search-modal' });
                    };
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
                    _map = undefined;
                }
            }
            _map.addControl(new SearchControl(), 'top-left');
        },
    };
}
