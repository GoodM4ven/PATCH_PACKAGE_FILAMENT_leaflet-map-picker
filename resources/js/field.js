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

export default function mapTilerPicker({ config, stateLat, stateLng }) {
    // ---- keep all heavy objects OUT of Alpine reactivity
    const cfg = { ...config }; // shallow copy only primitives you need
    setupSdk(cfg);

    let map = null;
    let marker = null;
    const lock = createLock(cfg);
    const styles = buildStyles(cfg.customStyles); // MapStyle objects stay here (not on `this`)

    const limiters = createLimiters(cfg.rateLimit);

    // ? Alpine store shortcut
    const S = () => Alpine.store('mt');

    return {
        // reactive data: primitives only (+ entangled proxy)
        lastFix: null,
        stateLat, // ✅ scalar entangle
        stateLng, // ✅ scalar entangle
        lat: null,
        lng: null,
        commitCoordinates: null,
        styleName: cfg.style, // expose only the current style string

        init() {
            if (!Alpine.store('mt')) {
                Alpine.store('mt', { searchQuery: '', localSearchResults: [], isSearching: false, searchTimeout: null });
            }
            // watch individual properties so we don't depend on object identity
            this.$watch('stateLat', (v) => this.onStateChanged({ lat: v, lng: this.stateLng }));
            this.$watch('stateLng', (v) => this.onStateChanged({ lat: this.stateLat, lng: v }));
            this.initMap();
        },

        initMap() {
            const initial = this.getInitialCoordinates();
            const center = [initial.lng, initial.lat];
            const mapOptions = {
                container: this.$refs.mapContainer,
                style: styles[this.styleName] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: cfg.defaultZoom,
                minZoom: cfg.minZoomLevel ?? undefined,
                maxZoom: cfg.maxZoomLevel ?? undefined,
                navigationControl: false,
                geolocateControl: false,
                terrainControl: false,
                scaleControl: false,
                fullscreenControl: false,
                projectionControl: false,
                hash: !!cfg.hash,
                maxBounds: cfg.maxBounds || undefined,
            };

            // ? Prepare locking overlay and banner
            lock.initUI(this.$refs.mapContainer);

            map = new maptilersdk.Map(mapOptions);
            lock.attachMap(map);

            const containerEl = map.getCanvasContainer?.() || map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, map, limiters, lock);
            if (cfg.showStyleSwitcher) {
                addStyleSwitcherControl(map, styles, cfg, lock, (s) => this.setStyle(s));
            }

            // ? Throttled coordinate updates (fallsback to global lock when violated)
            this.commitCoordinates = throttle((position) => {
                if (lock.isLocked()) return; // ? Banner is already running
                const t = limiters.pinMove.try();
                if (t.ok) this.pushToState(position);
                else lock.lockFor(t.resetMs);
            }, 300);

            // ? Guards geolocate button: intercept FIRST, then decide to lock, rate-limit, or trigger
            // ? Geolocate button (guarded above)
            const geoCfg = cfg.geolocate;
            if (geoCfg.enabled) {
                addGeolocateControl(map, this.$refs.mapContainer || containerEl, geoCfg, limiters, lock, {
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
            if (cfg.rotationable || cfg.zoomable) {
                map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: cfg.rotationable,
                        showZoom: cfg.zoomable,
                        visualizePitch: cfg.rotationable,
                    }),
                    'top-right'
                );
                // ? Hook to the guards
                hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, lock);
                map.on('styledata', () => hookNavButtons(this.$refs.mapContainer || containerEl, map, limiters, lock));
            }
            if (!cfg.rotationable) {
                map.dragRotate.disable();
                map.touchZoomRotate.disableRotation();
            }
            if (!cfg.zoomable) {
                map.scrollZoom.disable();
                map.boxZoom.disable();
                map.doubleClickZoom.disable();
                map.touchZoomRotate.disable();
                map.keyboard.disable();
            }

            // ? Applying localization to the labels
            this.applyLocaleIfNeeded();

            // ? The marker
            const mopts = { draggable: cfg.draggable };
            if (cfg.customMarker) mopts.element = createMarkerElement(cfg.customMarker);
            marker = new maptilersdk.Marker(mopts).setLngLat(center).addTo(map);

            // ? Initial positioning
            this.lat = initial.lat;
            this.lng = initial.lng;
            this.pushToState(initial);

            // ? Clicking to move
            if (cfg.clickable) {
                map.on('click', (e) => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: e.lngLat });
                });
            }
            // ? Dragging to move
            if (cfg.draggable) {
                marker.on('dragend', () => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: marker.getLngLat() });
                });
            }

            // ? Style and localize
            map.on('load', () => this.applyLocaleIfNeeded());
            map.on('styledata', () => this.applyLocaleIfNeeded());
            map.on('styleimagemissing', () => {}); // silence empty sprite warnings
            attachWebglFailureProtection(map, styles, cfg, () => this.hardRefreshSoon());
        },

        // Wrapped helpers (use closure vars)
        applyLocaleIfNeeded() {
            applyLocale(map, cfg.language, cfg.controlTranslations, this.$refs.mapContainer);
        },
        hardRefreshSoon() {
            if (document.visibilityState !== 'visible') return;
            if (!navigator.onLine) return;
            this.recreateMapInstance();
        },
        setStyle(styleName) {
            if (lock && lock.isLocked && lock.isLocked()) return;
            this.styleName = styleName;
            const style = styles[styleName] || maptilersdk.MapStyle.STREETS;
            try {
                map.setStyle(style);
            } catch (err) {
                /* ignore transient */
            }
        },
        recreateMapInstance() {
            const center = marker ? marker.getLngLat() : null;
            const zoom = map ? map.getZoom() : cfg.defaultZoom;
            const styleName = this.styleName;
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
            // IMPORTANT: mutate entangled proxy props; do NOT replace the object
            if (typeof position.lat === 'number') this.stateLat = position.lat;
            if (typeof position.lng === 'number') this.stateLng = position.lng;
        },
        getInitialCoordinates() {
            const lat = Number(this.stateLat);
            const lng = Number(this.stateLng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
            return { ...cfg.defaultLocation };
        },
    };
}
