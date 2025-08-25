import * as maptilersdk from '@maptiler/sdk';
import {
    throttle,
    debounce,
    backoffDelays,
    sleep,
    isTransientNetworkError,
    createRateLimiter,
    ensureOverlay,
    ensureCountdownBanner,
} from './helpers.js';
import { buildStyles, applyLocale } from './map-features.js';

const defaultConfig = {
    draggable: true,
    clickable: true,
    defaultZoom: 13,
    defaultLocation: { lat: 34.890832, lng: 38.542143 },
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
    geolocate: {},
    zoomable: true,
    rateLimit: {},
    controlTranslations: {},
};

export default function mapTilerPicker({ config }) {
    const cfg = { ...defaultConfig, ...config };

    let map = null;
    let marker = null;
    let styles = buildStyles(cfg.customTiles);
    let lastFix = null; // { lat, lng, accuracy, timestamp }

    const lock = {
        until: 0,
        tickId: null,
        overlay: null,
        banner: null,
        mapRef: null,
        isLocked() {
            return Date.now() < this.until;
        },
        remaining() {
            return Math.max(0, this.until - Date.now());
        },
        lockFor(ms) {
            const now = Date.now();
            this.until = Math.max(this.until, now + ms);
            this.apply(true);
            this.startTicker();
        },
        attachMap(mp) {
            this.mapRef = mp;
        },
        startTicker() {
            if (this.tickId) return;
            const tick = () => {
                const left = this.remaining();
                this.banner && this.banner.update(left);
                if (left <= 0) {
                    this.apply(false);
                    this.stopTicker();
                    return;
                }
                this.tickId = setTimeout(tick, 250);
            };
            this.tickId = setTimeout(tick, 0);
        },
        stopTicker() {
            clearTimeout(this.tickId);
            this.tickId = null;
            this.banner && this.banner.hide();
        },
        apply(locked) {
            if (!this.overlay || !this.banner) return;
            if (locked) {
                this.overlay.show();
            } else {
                this.overlay.hide();
            }
            // ? disable/enable zoom gesture handlers during lock
            if (this.mapRef) {
                // ? stop any ongoing animations immediately on lock
                if (locked) {
                    try {
                        this.mapRef.stop();
                    } catch (_) {}
                }
                if (locked) {
                    this.mapRef.scrollZoom.disable();
                    this.mapRef.touchZoomRotate.disable();
                    this.mapRef.dragPan.disable();
                } else {
                    this.mapRef.scrollZoom.enable({ around: 'center' });
                    this.mapRef.touchZoomRotate.enable({ around: 'center' });
                    this.mapRef.dragPan.enable();
                }
            }
        },
        initUI(container) {
            this.overlay = ensureOverlay(container);
            this.banner = ensureCountdownBanner(container);
        },
    };

    const limitCfg = cfg.rateLimit;
    const interval = limitCfg.interval;
    const limiters = {
        geolocate: createRateLimiter(limitCfg.geolocate, interval),
        zoom: createRateLimiter(limitCfg.zoom, interval),
        pinMove: createRateLimiter(limitCfg.pinMove, interval),
        cameraMove: createRateLimiter(limitCfg.cameraMove, interval),
        search: createRateLimiter(limitCfg.search, interval),
    };

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

            if (!this.config.apiKey) throw new Error('MapTiler API key is required');
            if (!window.__maptilerApiKey || window.__maptilerApiKey !== this.config.apiKey) {
                maptilersdk.config.apiKey = this.config.apiKey;
                window.__maptilerApiKey = this.config.apiKey;
            }

            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                maptilersdk.config.primaryLanguage = lang;
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

            // ? Intercepting interactions at the DOM layer to beat handlers
            map.__zoomTokenConsumed = false; // ? true when a zoom token was taken before zoomend
            map.__panTokenConsumed = false; // ? true when a pan token was taken at drag start
            const containerEl = map.getCanvasContainer?.() || map.getCanvas?.() || this.$refs.mapContainer;
            let lastCenter = map.getCenter();

            // ? Capture cameraMove token on pan-starting gesture
            const panStartGuardMouse = (ev) => {
                // ? Left-click button only
                if (ev.button !== 0) return;
                if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
                if (lock.isLocked()) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    return;
                }
                if (!map.__panTokenConsumed) {
                    const t = limiters.cameraMove.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__panTokenConsumed = true;
                }
            };
            const panStartGuardPointer = (ev) => {
                // ? Treat primary-pointer as a left-click too
                if (ev.isPrimary === false) return;
                if (lock.isLocked()) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    return;
                }
                if (!map.__panTokenConsumed) {
                    const t = limiters.cameraMove.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__panTokenConsumed = true;
                }
            };
            const panStartGuardTouch = (ev) => {
                const n = ev.touches ? ev.touches.length : 0;
                // ? Single-finger panning gesture; while pinching is handled in zoom guards
                if (n === 1) {
                    if (lock.isLocked()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        return;
                    }
                    if (!map.__panTokenConsumed) {
                        const t = limiters.cameraMove.try();
                        if (!t.ok) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            ev.stopImmediatePropagation?.();
                            lock.lockFor(t.resetMs);
                            return;
                        }
                        map.__panTokenConsumed = true;
                    }
                }
            };
            containerEl.addEventListener('mousedown', panStartGuardMouse, { capture: true });
            containerEl.addEventListener('pointerdown', panStartGuardPointer, { capture: true });
            containerEl.addEventListener('touchstart', panStartGuardTouch, { passive: false, capture: true });

            // ? Consuming wheel/trackpad token on every wheel step
            const onWheelDom = (ev) => {
                if (lock.isLocked()) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    return;
                }
                const t = limiters.zoom.try();
                if (!t.ok) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                    lock.lockFor(t.resetMs);
                    return;
                }
                map.__zoomTokenConsumed = true;
            };
            containerEl.addEventListener('wheel', onWheelDom, { passive: false, capture: true });

            // ? Pinching zoom (touchstart and touchmove)
            const onTouchStartDom = (ev) => {
                const n = ev.touches ? ev.touches.length : 0;
                if (n >= 2) {
                    if (lock.isLocked()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        return;
                    }
                    const t = limiters.zoom.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__zoomTokenConsumed = true;
                }
            };
            const onTouchMoveDom = (ev) => {
                const n = ev.touches ? ev.touches.length : 0;
                if (n >= 2 && lock.isLocked()) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();
                }
            };
            containerEl.addEventListener('touchstart', onTouchStartDom, { passive: false, capture: true });
            containerEl.addEventListener('touchmove', onTouchMoveDom, { passive: false, capture: true });

            // ? Double-clicking zoom
            map.on('dblclick', (e) => {
                if (lock.isLocked()) {
                    e.preventDefault();
                    return;
                }
                const t = limiters.zoom.try();
                if (!t.ok) {
                    e.preventDefault();
                    lock.lockFor(t.resetMs);
                    return;
                }
                map.__zoomTokenConsumed = true;
            });

            // ? Guards navigation control buttons
            const hookNavButtons = () => {
                const root = this.$refs.mapContainer || containerEl;
                const inBtn = root.querySelector('.maplibregl-ctrl-zoom-in');
                const outBtn = root.querySelector('.maplibregl-ctrl-zoom-out');
                const guard = (ev) => {
                    if (lock.isLocked()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        return;
                    }
                    const t = limiters.zoom.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__zoomTokenConsumed = true;
                };
                [inBtn, outBtn].forEach((btn) => {
                    if (!btn) return;
                    ['mousedown', 'click'].forEach((type) => btn.addEventListener(type, guard, { capture: true }));
                });
            };

            // ? Throttled coordinate updates (fallsback to global lock when violated)
            this.commitCoordinates = throttle((position) => {
                if (lock.isLocked()) return; // ? Banner is already running
                const t = limiters.pinMove.try();
                if (t.ok) this.setCoordinates(position);
                else lock.lockFor(t.resetMs);
            }, 300);

            // ? Guards geolocate button: intercept FIRST, then decide to lock, rate-limit, or trigger
            const hookGeoButton = (geo) => {
                const root = this.$refs.mapContainer || containerEl;
                const btn = root.querySelector('.maplibregl-ctrl-geolocate');
                if (!btn) return;
                if (btn.dataset.geoGuarded === '1') return;
                let geoInFlight = false;

                const guard = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation?.();

                    if (lock.isLocked()) return;

                    // ? Rate-limit the clikcing of the button itself
                    const clickToken = limiters.geolocate.try();
                    if (!clickToken.ok) {
                        lock.lockFor(clickToken.resetMs);
                        return;
                    }
                    // ? If we have a recent cached fix, jump instantly and stop here
                    const now = Date.now();
                    const freshFor = (this.config.geolocate && this.config.geolocate.cacheInMs) || Infinity;
                    if (lastFix && now - lastFix.timestamp <= freshFor) {
                        this.jumpTo({ lat: lastFix.lat, lng: lastFix.lng }, { zoom: 15 });
                        return;
                    }
                    // ? If a native request is already running, we'll let that request update lastFix, and move the camera
                    if (geoInFlight) return;
                    const t = limiters.geolocate.try();
                    if (!t.ok) {
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    // ? Manual triggering of geolocation
                    try {
                        geoInFlight = true;
                        geo.trigger();
                    } catch (_) {}
                };

                // ? Only handle the single 'click' to avoid double-trigger
                btn.addEventListener('click', guard, { capture: true });
                btn.addEventListener(
                    'keydown',
                    (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') guard(ev);
                    },
                    { capture: true }
                );
                btn.dataset.geoGuarded = '1';

                // ? Clear the flags
                geo.on('geolocate', () => (geoInFlight = false));
                geo.on('error', () => (geoInFlight = false));
            };

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
                hookGeoButton(geo);
                map.on('styledata', () => hookGeoButton(geo));
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
                hookNavButtons();
                map.on('styledata', hookNavButtons);
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
            if (this.config.customMarker) mopts.element = this.createMarkerElement(this.config.customMarker);
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

            // ? Zooming camera
            let lastZoom = map.getZoom();
            let suppressZoom = false;
            map.on('zoomend', () => {
                // ? When rate-limited
                if (map.__zoomTokenConsumed) {
                    map.__zoomTokenConsumed = false;
                    lastZoom = map.getZoom(); // ? Accept the zoom result before locking
                    return;
                }
                if (suppressZoom) {
                    suppressZoom = false;
                    return;
                }
                if (lock.isLocked()) {
                    suppressZoom = true;
                    map.setZoom(lastZoom);
                    return;
                }
                const t = limiters.zoom.try();
                if (!t.ok) {
                    suppressZoom = true;
                    map.setZoom(lastZoom);
                    lock.lockFor(t.resetMs);
                } else lastZoom = map.getZoom();
            });

            // ? Guarding against keyboard buttons as possible interaction tricks
            const onKeyDown = (ev) => {
                const k = ev.key;
                // ? Possible zooming buttons
                if (k === '+' || k === '=' || k === '-') {
                    if (lock.isLocked()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        return;
                    }
                    const t = limiters.zoom.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__zoomTokenConsumed = true;
                }
                // ? Arrow keys for panning the camera
                if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
                    if (lock.isLocked()) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        return;
                    }
                    const t = limiters.cameraMove.try();
                    if (!t.ok) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation?.();
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__panTokenConsumed = true;
                    // ? Reset to allow subsequent arrow key to count as a new gesture?
                    setTimeout(() => (map.__panTokenConsumed = false), 250);
                }
            };
            containerEl.addEventListener('keydown', onKeyDown, { capture: true });

            // ? Guard the drag-start event, when pan-start guard doesn't handle things
            map.on('dragstart', () => {
                if (lock.isLocked()) {
                    try {
                        map.stop();
                    } catch (_) {}
                    map.setCenter(lastCenter);
                    return;
                }
                if (!map.__panTokenConsumed) {
                    const t = limiters.cameraMove.try();
                    if (!t.ok) {
                        try {
                            map.stop();
                        } catch (_) {}
                        map.setCenter(lastCenter);
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    map.__panTokenConsumed = true;
                }
            });

            // ? When dragging finishes, reset token and save position
            map.on('dragend', () => {
                map.__panTokenConsumed = false;
                lastCenter = map.getCenter();
            });
            map.on('moveend', (e) => {
                if (lock.isLocked()) return;
                // ? Only counts user-driven moves
                if (e.originalEvent) {
                    lastCenter = map.getCenter();
                }
            });

            // ? Style and localize
            map.on('load', () => this.applyLocaleIfNeeded());
            map.on('styledata', () => this.applyLocaleIfNeeded());
            map.on('styleimagemissing', () => {}); // silence empty sprite warnings

            // ? WebGL errors recovery
            map.on('webglcontextlost', (e) => {
                e.preventDefault();
                this.tryReloadStyleWithBackoff().then((ok) => {
                    if (!ok) this.hardRefreshSoon();
                });
            });
            let errorTimer = null;
            map.on('error', (evt) => {
                const err = evt && evt.error;
                if (!isTransientNetworkError(err)) return;
                if (errorTimer) clearTimeout(errorTimer);
                errorTimer = setTimeout(() => {
                    this.tryReloadStyleWithBackoff().then((ok) => {
                        if (!ok) this.hardRefreshSoon();
                    });
                }, 150);
            });
            window.addEventListener('online', () => {
                this.tryReloadStyleWithBackoff().then((ok) => {
                    if (!ok) this.hardRefreshSoon();
                });
            });
            document.addEventListener(
                'visibilitychange',
                () => {
                    if (document.visibilityState === 'visible') {
                        this.tryReloadStyleWithBackoff().then((ok) => {
                            if (!ok) this.hardRefreshSoon();
                        });
                    }
                },
                { passive: true }
            );
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

        async tryReloadStyleWithBackoff() {
            const delays = backoffDelays(5);
            for (let i = 0; i < delays.length; i++) {
                try {
                    const style = styles[this.config.style] || maptilersdk.MapStyle.STREETS;
                    map.setStyle(style);
                    await new Promise((resolve, reject) => {
                        const onError = (e) => reject(e && e.error ? e.error : new Error('style error'));
                        const onStyle = () => {
                            map.off('error', onError);
                            resolve();
                        };
                        map.once('styledata', onStyle);
                        map.once('error', onError);
                    });
                    return true;
                } catch (err) {
                    if (!isTransientNetworkError(err)) break;
                    await sleep(delays[i]);
                }
            }
            return false;
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
                    select.onchange = (e) => {
                        if (!lock.isLocked()) self.setStyle(e.target.value);
                    };
                    this.container.appendChild(label);
                    this.container.appendChild(select);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
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

        // ? A simple marker element fallback
        createMarkerElement(spec) {
            // ? can be { html, className, style } or string HTML
            if (typeof spec === 'string') {
                const d = document.createElement('div');
                d.innerHTML = spec.trim();
                return d.firstElementChild || d;
            }
            const el = document.createElement('div');
            if (spec.className) el.className = spec.className;
            if (spec.style) Object.assign(el.style, spec.style);
            el.innerHTML = spec.html || '';
            return el;
        },
    };
}
