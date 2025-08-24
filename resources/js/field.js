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

export default function mapTilerPicker({ config }) {
    // Internals ---------------------------------------------------------------
    let map = null;
    let marker = null;
    let styles = null;

    // Global "any rate-limit => lock everything" ------------------------------
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
            // Belt & suspenders: disable/enable zoom gesture handlers during lock
            if (this.mapRef) {
                // stop any ongoing animations immediately on lock
                if (locked) {
                    try {
                        this.mapRef.stop();
                    } catch (_) {}
                }
                if (locked) {
                    this.mapRef.scrollZoom.disable();
                    this.mapRef.touchZoomRotate.disable();
                } else {
                    this.mapRef.scrollZoom.enable({ around: 'center' });
                    this.mapRef.touchZoomRotate.enable({ around: 'center' });
                }
            }
        },
        initUI(container) {
            this.overlay = ensureOverlay(container);
            this.banner = ensureCountdownBanner(container);
        },
    };

    // Rate limiters -----------------------------------------------------------
    const limitCfg = config.rateLimit || {};
    const interval = limitCfg.interval ?? 60000;
    const limiters = {
        geolocate: createRateLimiter(limitCfg.geolocate ?? 5, interval),
        zoom: createRateLimiter(limitCfg.zoom ?? 60, interval),
        pinMove: createRateLimiter(limitCfg.pinMove ?? 60, interval),
        cameraMove: createRateLimiter(limitCfg.cameraMove ?? 120, interval),
        search: createRateLimiter(limitCfg.search ?? 10, interval),
    };

    // Locales (kept concise) --------------------------------------------------
    const locales = {
        ar: {
            'NavigationControl.ZoomIn': 'تكبير',
            'NavigationControl.ZoomOut': 'تصغير',
            'NavigationControl.ResetBearing': 'إعادة الاتجاه إلى الشمال',
            'NavigationControl.RotateLeft': 'استدارة لليسار',
            'NavigationControl.RotateRight': 'استدارة لليمين',
            'NavigationControl.PitchUp': 'رفع الميل',
            'NavigationControl.PitchDown': 'خفض الميل',
            'FullscreenControl.Enter': 'دخول ملء الشاشة',
            'FullscreenControl.Exit': 'خروج من ملء الشاشة',
            'GeolocateControl.FindMyLocation': 'تحديد موقعي',
            'GeolocateControl.LocationNotAvailable': 'الموقع غير متاح',
            'ScaleControl.Meters': 'م',
            'ScaleControl.Kilometers': 'كم',
            'ScaleControl.Miles': 'ميل',
            'ScaleControl.NauticalMiles': 'ميل بحري',
            'AttributionControl.ToggleAttribution': 'إظهار/إخفاء الإسناد',
            'TerrainControl.Toggle': 'تفعيل/إلغاء تضاريس ثلاثية الأبعاد',
            'ProjectionControl.Toggle': 'تبديل الإسقاط',
        },
    };

    // Alpine store shortcut
    const S = () => Alpine.store('mt');

    // Component API -----------------------------------------------------------
    return {
        lat: null,
        lng: null,
        commitCoordinates: null,
        config: {
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
            geolocate: { enabled: false, runOnLoad: false, pinAsWell: true },
            zoomable: true,
        },

        // Lifecycle -------------------------------------------------------------
        init() {
            if (!Alpine.store('mt')) {
                Alpine.store('mt', { searchQuery: '', localSearchResults: [], isSearching: false, searchTimeout: null });
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

            if (typeof this.config.geolocate === 'boolean') {
                this.config.geolocate = { enabled: this.config.geolocate, runOnLoad: false, pinAsWell: true };
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

            // Prepare overlay + banner before any locking
            lock.initUI(this.$refs.mapContainer);

            map = new maptilersdk.Map(mapOptions);
            lock.attachMap(map);

            // --- Early, synchronous rate-limit for ALL zoom inputs ---------------
            // We intercept at the DOM layer (canvas container) to beat handlers.
            map.__zoomTokenConsumed = false; // true when a zoom token was taken before zoomend
            const containerEl = map.getCanvasContainer?.() || map.getCanvas?.() || this.$refs.mapContainer;

            // Wheel / trackpad: consume a token on EVERY wheel step; if out, block instantly
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

            // Pinch zoom: guard on both touchstart and touchmove for immediate blocking
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

            // Double click zoom: pre-empt DoubleClickZoomHandler
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

            // Navigation control buttons: intercept click/mousedown at capture phase
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

            // Throttled writer (drops to global lock when pin quota is out)
            this.commitCoordinates = throttle((position) => {
                if (lock.isLocked()) return; // locked: do nothing (banner is already running)
                const t = limiters.pinMove.try();
                if (t.ok) this.setCoordinates(position);
                else lock.lockFor(t.resetMs);
            }, 300);

            // Geolocate
            const geoCfg = this.config.geolocate || { enabled: false, runOnLoad: false, pinAsWell: true };
            if (geoCfg.enabled) {
                const geo = new maptilersdk.GeolocateControl({
                    trackUserLocation: true,
                    positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 },
                    fitBoundsOptions: { maxZoom: 15 },
                });
                map.addControl(geo, 'top-right');
                geo.on('geolocate', (e) => {
                    if (lock.isLocked()) return;
                    const t = limiters.geolocate.try();
                    if (!t.ok) {
                        lock.lockFor(t.resetMs);
                        return;
                    }
                    if (geoCfg.pinAsWell !== false) {
                        const { latitude, longitude } = e.coords;
                        marker.setLngLat([longitude, latitude]);
                        this.lat = latitude;
                        this.lng = longitude;
                        this.commitCoordinates({ lat: latitude, lng: longitude });
                        map.easeTo({ center: [longitude, latitude] });
                    }
                });
                if (geoCfg.runOnLoad) map.on('load', () => !lock.isLocked() && geo.trigger());
            }

            // Navigation control (honour config)
            if (this.config.rotationable || this.config.zoomable) {
                map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: this.config.rotationable,
                        showZoom: this.config.zoomable,
                        visualizePitch: this.config.rotationable,
                    }),
                    'top-right'
                );
                // Hook the buttons now and also after style mutations
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

            this.applyLocaleIfNeeded();

            // Marker
            const mopts = { draggable: this.config.draggable };
            if (this.config.customMarker) mopts.element = this.createMarkerElement(this.config.customMarker);
            marker = new maptilersdk.Marker(mopts).setLngLat(center).addTo(map);

            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            // Click to move
            if (this.config.clickable)
                map.on('click', (e) => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: e.lngLat });
                });
            // Drag pin
            if (this.config.draggable)
                marker.on('dragend', () => {
                    if (lock.isLocked()) return;
                    this.markerMoved({ latLng: marker.getLngLat() });
                });

            // Zoom limiter
            let lastZoom = map.getZoom();
            let suppressZoom = false;
            map.on('zoomend', () => {
                // If wheel/pinch path already consumed a token for this gesture,
                // skip the zoom token here (buttons still use this path).
                if (map.__zoomTokenConsumed) {
                    map.__zoomTokenConsumed = false;
                    lastZoom = map.getZoom(); // accept the zoom result
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

            // Optional: keyboard +/- and = zoom guard (capture at DOM)
            const onKeyDown = (ev) => {
                const k = ev.key;
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
            };
            containerEl.addEventListener('keydown', onKeyDown, { capture: true });

            // Camera pan limiter (user pans)
            map.on('dragend', () => {
                if (lock.isLocked()) return;
                const t = limiters.cameraMove.try();
                if (!t.ok) lock.lockFor(t.resetMs);
                // Side-effects like saveViewport() could be done here if t.ok
            });
            // Optionally count programmatic moves too
            map.on('moveend', (e) => {
                if (lock.isLocked()) return;
                if (!e.originalEvent) {
                    const t = limiters.cameraMove.try();
                    if (!t.ok) lock.lockFor(t.resetMs);
                }
            });

            // Style/locale lifecycle
            map.on('load', () => this.applyLocaleIfNeeded());
            map.on('styledata', () => this.applyLocaleIfNeeded());
            map.on('styleimagemissing', () => {}); // silence empty sprite warnings

            // WebGL/context & transient errors recovery
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

        // Locale helpers ---------------------------------------------------------
        applyLocaleIfNeeded() {
            const lang = this.config.language;
            if (!lang) return;
            const primary = maptilersdk.Language[lang] || lang;
            try {
                map.setLanguage(primary);
            } catch {}
            const dict = locales[lang];
            if (dict) {
                try {
                    map.setLocale(dict);
                } catch {}
                this.forceArabicTitlesFallback(dict);
            }
        },
        forceArabicTitlesFallback(dict = {}) {
            const set = (sel, title) => {
                const el = this.$refs.mapContainer.querySelector(sel);
                if (el && title) {
                    el.setAttribute('title', title);
                    el.setAttribute('aria-label', title);
                    el.setAttribute('dir', 'rtl');
                }
            };
            set('.maplibregl-ctrl-zoom-in', dict['NavigationControl.ZoomIn'] || 'تكبير');
            set('.maplibregl-ctrl-zoom-out', dict['NavigationControl.ZoomOut'] || 'تصغير');
            set('.maplibregl-ctrl-compass', dict['NavigationControl.ResetBearing'] || 'إعادة الاتجاه إلى الشمال');
            set('.maplibregl-ctrl-pitchtoggle', dict['NavigationControl.PitchUp'] || 'رفع الميل');
            set('.maplibregl-ctrl-rotate-left', dict['NavigationControl.RotateLeft'] || 'استدارة لليسار');
            set('.maplibregl-ctrl-rotate-right', dict['NavigationControl.RotateRight'] || 'استدارة لليمين');
            set('.maplibregl-ctrl-fullscreen', dict['FullscreenControl.Enter'] || 'دخول ملء الشاشة');
            set('.maplibregl-ctrl-geolocate', dict['GeolocateControl.FindMyLocation'] || 'تحديد موقعي');
        },

        // Search helpers ---------------------------------------------------------
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

        // Misc UI controls -------------------------------------------------------
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

        // Position updates -------------------------------------------------------
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

        // Wire bridge ------------------------------------------------------------
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

        // Simple marker element fallback ----------------------------------------
        createMarkerElement(spec) {
            // spec can be { html, className, style } or string HTML
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
