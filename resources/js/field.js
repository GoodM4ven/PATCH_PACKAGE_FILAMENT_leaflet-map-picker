import * as maptilersdk from '@maptiler/sdk';
import { throttle, isTransientNetworkError } from './helpers.js';
import {
    buildStyles,
    applyLocale,
    setupSdk,
    createLock,
    createLimiters,
    createMarkerElement,
    hookGeolocateButton,
    hookNavButtons,
    hookInteractionGuards,
    addStyleSwitcherControl,
    attachWebglFailureProtection,
} from './map-features.js';

export default function mapTilerPicker({ config }) {
    const cfg = config;
    setupSdk(cfg);

    let map = null;
    let marker = null;
    let styles = buildStyles(cfg.customStyles);
    let lastFix = null; // { lat, lng, accuracy, timestamp }

    const lock = createLock(cfg);
    const limiters = createLimiters(cfg.rateLimit);

    // ? Alpine store shortcut
    const S = () => Alpine.store('mt');

    return {
        lat: null,
        lng: null,
        commitCoordinates: null,
        config: cfg,

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
                style: styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: this.config.defaultZoom,
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

            // ? Prepare locking overlay and banner
            lock.initUI(this.$refs.mapContainer);

            map = new maptilersdk.Map(mapOptions);
            lock.attachMap(map);

            const containerEl = map.getCanvasContainer?.() || map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, map, limiters, lock);
            if (this.config.showStyleSwitcher) {
                addStyleSwitcherControl(map, styles, this.config, lock, (s) => this.setStyle(s));
            }

            // ? Throttled coordinate updates (fallsback to global lock when violated)
            this.commitCoordinates = throttle((position) => {
                if (lock.isLocked()) return; // ? Banner is already running
                const t = limiters.pinMove.try();
                if (t.ok) this.setCoordinates(position);
                else lock.lockFor(t.resetMs);
            }, 300);

            // ? Guards geolocate button: intercept FIRST, then decide to lock, rate-limit, or trigger
            // ? Geolocate button (guarded above)
            const geoCfg = this.config.geolocate;
            if (geoCfg.enabled) {
                const geo = new maptilersdk.GeolocateControl({
                    trackUserLocation: true,
                    positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 },
                    fitBoundsOptions: { maxZoom: 15 },
                });
                map.addControl(geo, 'top-right');
                // ? Hooking to the guard
                const geoOpts = {
                    container: this.$refs.mapContainer || containerEl,
                    geo,
                    limiters,
                    lock,
                    lastFix: () => lastFix,
                    jumpTo: (pos, opts) => this.jumpTo(pos, opts),
                    cacheMs: (this.config.geolocate && this.config.geolocate.cacheInMs) || Infinity,
                };
                hookGeolocateButton(geoOpts);
                map.on('styledata', () => hookGeolocateButton(geoOpts));
                geo.on('geolocate', (e) => {
                    if (lock.isLocked()) return;
                    if (geoCfg.pinAsWell !== false) {
                        const { latitude, longitude } = e.coords;
                        marker.setLngLat([longitude, latitude]);
                        this.lat = latitude;
                        this.lng = longitude;
                        this.commitCoordinates({ lat: latitude, lng: longitude });
                        lastFix = {
                            lat: latitude,
                            lng: longitude,
                            accuracy: typeof accuracy === 'number' ? accuracy : null,
                            timestamp: Date.now(),
                        };
                    }
                });

                // ? Optionally auto-trigger geolocation on load
                if (geoCfg.runOnLoad) {
                    map.on('load', () => {
                        if (lock.isLocked()) return;
                        const t = limiters.geolocate.try();
                        if (!t.ok) {
                            lock.lockFor(t.resetMs);
                            return;
                        }
                        try {
                            geo.trigger();
                        } catch (_) {}
                    });
                }
            }

            // ? Navigation control buttons (guarded above)
            if (this.config.rotationable || this.config.zoomable) {
                map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: this.config.rotationable,
                        showZoom: this.config.zoomable,
                        visualizePitch: this.config.rotationable,
                    }),
                    'top-right'
                );
                // ? Hook to the guards
                hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, lock);
                map.on('styledata', () => hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, lock));
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

            // ? Applying localization to the labels
            this.applyLocaleIfNeeded();

            // ? The marker
            const mopts = { draggable: this.config.draggable };
            if (this.config.customMarker) mopts.element = createMarkerElement(this.config.customMarker);
            marker = new maptilersdk.Marker(mopts).setLngLat(center).addTo(map);

            // ? Initial positioning
            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            // ? Clicking to move
            if (this.config.clickable) {
                map.on('click', (e) => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: e.lngLat });
                });
            }
            // ? Dragging to move
            if (this.config.draggable) {
                marker.on('dragend', () => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: marker.getLngLat() });
                });
            }

            // ? Style and localize
            map.on('load', () => this.applyLocaleIfNeeded());
            map.on('styledata', () => this.applyLocaleIfNeeded());
            map.on('styleimagemissing', () => {}); // silence empty sprite warnings
            attachWebglFailureProtection(map, styles, this.config, () => this.hardRefreshSoon());
        },

        recreateMapInstance() {
            const center = marker ? marker.getLngLat() : null;
            const zoom = map ? map.getZoom() : this.config.defaultZoom;
            const styleName = this.config.style;
            try {
                map && map.remove();
            } catch (_) {}
            map = null;
            marker = null;

            this.initMap();

            if (center) {
                map.setCenter([center.lng, center.lat]);
                map.setZoom(zoom);
                marker.setLngLat([center.lng, center.lat]);
            }
            if (styleName) this.setStyle(styleName);
        },

        setStyle(styleName) {
            if (lock.isLocked()) return;
            this.config.style = styleName;
            const style = styles[styleName] || maptilersdk.MapStyle.STREETS;
            try {
                map.setStyle(style);
            } catch (err) {
                if (isTransientNetworkError(err)) this.hardRefreshSoon();
                else console.error('setStyle failed:', err);
            }
        },

        hardRefreshSoon() {
            if (document.visibilityState !== 'visible') return;
            if (!navigator.onLine) return;
            this.recreateMapInstance();
        },

        applyLocaleIfNeeded() {
            applyLocale(map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer);
        },

        // ? =======
        // ? Search
        // ? =====

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
            if (lock.isLocked()) {
                st.isSearching = false;
                return;
            }
            const t = limiters.search.try();
            if (!t.ok) {
                st.isSearching = false;
                lock.lockFor(t.resetMs);
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
            this.commitCoordinates({ lat, lng });
            const st = S();
            st.localSearchResults = [];
            st.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
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
                    btn.innerHTML =
                        '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>';
                    btn.title = self.config.searchLocationButtonLabel || 'Search Location';
                    btn.onclick = () => {
                        if (!lock.isLocked()) self.$dispatch('open-modal', { id: 'location-search-modal' });
                    };
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
                    this.map = undefined;
                }
            }
            map.addControl(new SearchControl(), 'top-left');
        },

        // ? ============
        // ? Positioning
        // ? ==========

        jumpTo(position, { zoom } = {}) {
            // programmatic move: we *do not* count this against cameraMove
            marker.setLngLat([position.lng, position.lat]);
            if (typeof zoom === 'number') {
                map.jumpTo({ center: [position.lng, position.lat], zoom });
            } else {
                map.jumpTo({ center: [position.lng, position.lat] });
            }
            this.lat = position.lat;
            this.lng = position.lng;
        },
        markerMoved(event) {
            const p = event.latLng;
            this.lat = p.lat;
            this.lng = p.lng;
            this.commitCoordinates({ lat: this.lat, lng: this.lng });
            marker.setLngLat([this.lng, this.lat]);
            map.easeTo({ center: [this.lng, this.lat] });
        },
        updateMapFromAlpine() {
            const location = this.getCoordinates();
            const pos = marker.getLngLat();
            if (location.lat !== pos.lat || location.lng !== pos.lng) this.updateMap(location);
        },
        updateMap(position) {
            marker.setLngLat([position.lng, position.lat]);
            map.easeTo({ center: [position.lng, position.lat] });
            this.lat = position.lat;
            this.lng = position.lng;
        },

        // ? =================
        // ? Livewire Updates
        // ? ===============
        
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
