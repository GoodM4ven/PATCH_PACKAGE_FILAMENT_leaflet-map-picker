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
    attachWebglFailureProtection,
    applyLocale,
} from './map-features.js';

export default function mapTilerPicker({ config, state }) {
    const cfg = config;
    setupSdk(cfg);

    // Keep SDK objects out of Alpine reactivity
    let map = null;
    let marker = null;

    const limiters = createLimiters(cfg.rateLimit);

    // ? Alpine store shortcut
    const S = () => Alpine.store('mt');

    return {
        styles: buildStyles(cfg.customStyles),
        lock: createLock(cfg),
        lastFix: null,
        lat: null,
        lng: null,
        commitCoordinates: null,
        config: cfg,
        state,

        init() {
            if (!Alpine.store('mt')) {
                Alpine.store('mt', { searchQuery: '', localSearchResults: [], isSearching: false, searchTimeout: null });
            }
            this.$watch('state', (val) => this.onStateChanged(val));
            this.initMap();
        },

        initMap() {
            const initial = this.getInitialCoordinates();
            const center = [initial.lng, initial.lat];
            const mapOptions = {
                container: this.$refs.mapContainer,
                style: this.styles[this.config.style] || maptilersdk.MapStyle.STREETS,
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
            this.lock.initUI(this.$refs.mapContainer);

            map = new maptilersdk.Map(mapOptions);
            this.lock.attachMap(map);

            const containerEl = map.getCanvasContainer?.() || map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, map, limiters, this.lock);
            if (this.config.showStyleSwitcher) {
                addStyleSwitcherControl(map, this.styles, this.config, this.lock, (s) => this.setStyle(s));
            }

            // ? Throttled coordinate updates (fallsback to global lock when violated)
            this.commitCoordinates = throttle((position) => {
                if (this.lock.isLocked()) return; // ? Banner is already running
                const t = limiters.pinMove.try();
                if (t.ok) this.pushToState(position);
                else this.lock.lockFor(t.resetMs);
            }, 300);

            // ? Guards geolocate button: intercept FIRST, then decide to lock, rate-limit, or trigger
            // ? Geolocate button (guarded above)
            const geoCfg = this.config.geolocate;
            if (geoCfg.enabled) {
                addGeolocateControl(map, this.$refs.mapContainer || containerEl, geoCfg, limiters, this.lock, {
                    lastFix: () => this.lastFix,
                    jumpTo: (pos, opts) => this.jumpTo(pos, opts),
                    onGeolocate: (e) => {
                        if (geoCfg.pinAsWell !== false) {
                            const { latitude, longitude, accuracy } = e.coords;
                            marker.setLngLat([longitude, latitude]);
                            this.lat = latitude;
                            this.lng = longitude;
                            this.commitCoordinates({ lat: latitude, lng: longitude });
                            this.lastFix = {
                                lat: latitude,
                                lng: longitude,
                                accuracy: typeof accuracy === 'number' ? accuracy : null,
                                timestamp: Date.now(),
                            };
                        }
                    },
                });
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
                hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, this.lock);
                map.on('styledata', () => hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, this.lock));
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
            this.pushToState(initial);

            // ? Clicking to move
            if (this.config.clickable) {
                map.on('click', (e) => {
                    if (this.lock.isLocked()) return;
                    this.markerMoved({ latLng: e.lngLat });
                });
            }
            // ? Dragging to move
            if (this.config.draggable) {
                marker.on('dragend', () => {
                    if (this.lock.isLocked()) return;
                    this.markerMoved({ latLng: marker.getLngLat() });
                });
            }

            // ? Style and localize
            map.on('load', () => this.applyLocaleIfNeeded());
            map.on('styledata', () => this.applyLocaleIfNeeded());
            map.on('styleimagemissing', () => {}); // silence empty sprite warnings
            attachWebglFailureProtection(map, this.styles, this.config, () => this.hardRefreshSoon());
        },

        // Wrapped helpers (use closure vars)
        applyLocaleIfNeeded() {
            applyLocale(map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer);
        },
        hardRefreshSoon() {
            if (document.visibilityState !== 'visible') return;
            if (!navigator.onLine) return;
            this.recreateMapInstance();
        },
        setStyle(styleName) {
            if (this.lock && this.lock.isLocked && this.lock.isLocked()) return;
            this.config.style = styleName;
            const style = this.styles[styleName] || maptilersdk.MapStyle.STREETS;
            try {
                map.setStyle(style);
            } catch (err) {
                /* ignore transient */
            }
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
            if (this.lock.isLocked()) {
                st.isSearching = false;
                return;
            }
            const t = limiters.search.try();
            if (!t.ok) {
                st.isSearching = false;
                this.lock.lockFor(t.resetMs);
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
                        if (!self.lock.isLocked()) self.$dispatch('open-modal', { id: 'location-search-modal' });
                    };
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
                    this.map = undefined;
                }
            }
            this.map.addControl(new SearchControl(), 'top-left');
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
        updateMap(position) {
            marker.setLngLat([position.lng, position.lat]);
            map.easeTo({ center: [position.lng, position.lat] });
            this.lat = position.lat;
            this.lng = position.lng;
        },

        // ? =================
        // ? Livewire Updates
        // ? ===============

        // ===== Livewire/Filament state bridge (no direct $wire calls) =====
        onStateChanged(val) {
            // when server (or another field) changes the state, reflect it on the map
            if (!val || typeof val.lat !== 'number' || typeof val.lng !== 'number') return;
            const pos = marker ? marker.getLngLat() : null;
            if (!pos || pos.lat !== val.lat || pos.lng !== val.lng) {
                this.updateMap({ lat: val.lat, lng: val.lng });
            }
        },
        pushToState(position) {
            // write to entangled state (this triggers a single Livewire model update honoring modifiers)
            this.state = { lat: position.lat, lng: position.lng };
        },
        getInitialCoordinates() {
            const v = this.state;
            if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') {
                return { ...this.config.defaultLocation };
            }
            return { lat: v.lat, lng: v.lng };
        },
    };
}
