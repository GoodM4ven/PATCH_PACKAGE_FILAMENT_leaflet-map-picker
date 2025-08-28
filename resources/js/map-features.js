import * as maptilersdk from '@maptiler/sdk';
import {
    createRateLimiter,
    ensureOverlay,
    ensureCountdownBanner,
    backoffDelays,
    sleep,
    isTransientNetworkError,
} from './helpers.js';

export function buildStyles(customStyles = {}) {
    // Build using static MapTiler style IDs to avoid Proxy objects and SDK warnings
    const base = {
        // Streets
        STREETS: 'streets-v2',
        'STREETS.DARK': 'streets-v2-dark',
        'STREETS.LIGHT': 'streets-v2-light',
        'STREETS.PASTEL': 'streets-v2-pastel',
        // Outdoor
        OUTDOOR: 'outdoor-v2',
        'OUTDOOR.DARK': 'outdoor-v2-dark',
        // Winter
        WINTER: 'winter-v2',
        'WINTER.DARK': 'winter-v2-dark',
        // Satellite/Hybrid
        SATELLITE: 'satellite',
        HYBRID: 'hybrid', // deprecated at source but harmless string here
        // Basic
        BASIC: 'basic-v2',
        'BASIC.DARK': 'basic-v2-dark',
        'BASIC.LIGHT': 'basic-v2-light',
        // Bright
        BRIGHT: 'bright-v2',
        'BRIGHT.DARK': 'bright-v2-dark',
        'BRIGHT.LIGHT': 'bright-v2-light',
        'BRIGHT.PASTEL': 'bright-v2-pastel',
        // OSM
        OPENSTREETMAP: 'openstreetmap',
        // Topo
        TOPO: 'topo-v2',
        'TOPO.DARK': 'topo-v2-dark',
        'TOPO.PASTEL': 'topo-v2-pastel',
        'TOPO.TOPOGRAPHIQUE': 'topo-v2-topographique',
        // Toner
        TONER: 'toner-v2',
        'TONER.LITE': 'toner-v2-lite',
        // Dataviz
        DATAVIZ: 'dataviz',
        'DATAVIZ.DARK': 'dataviz-dark',
        'DATAVIZ.LIGHT': 'dataviz-light',
        // Backdrop
        BACKDROP: 'backdrop',
        'BACKDROP.DARK': 'backdrop-dark',
        'BACKDROP.LIGHT': 'backdrop-light',
        // Ocean
        OCEAN: 'ocean',
        // Aquarelle
        AQUARELLE: 'aquarelle',
        'AQUARELLE.DARK': 'aquarelle-dark',
        'AQUARELLE.VIVID': 'aquarelle-vivid',
        // Landscape
        LANDSCAPE: 'landscape',
        'LANDSCAPE.DARK': 'landscape-dark',
        'LANDSCAPE.VIVID': 'landscape-vivid',
    };

    // Normalize custom styles: keep strings, deep-clone objects to remove proxies
    const normalizedCustom = {};
    for (const [k, v] of Object.entries(customStyles || {})) {
        if (typeof v === 'string') normalizedCustom[k] = v;
        else if (v && typeof v === 'object') {
            try {
                normalizedCustom[k] = JSON.parse(JSON.stringify(v));
            } catch (_) {
                normalizedCustom[k] = v;
            }
        }
    }

    return { ...base, ...normalizedCustom };
}

export function setupSdk(cfg) {
    if (cfg.language) {
        cfg.language = cfg.language.toLowerCase();
        if (cfg.language === 'arabic') cfg.language = 'ar';
    }

    if (!cfg.apiKey) throw new Error('MapTiler API key is required');

    if (!window.__maptilerApiKey || window.__maptilerApiKey !== cfg.apiKey) {
        maptilersdk.config.apiKey = cfg.apiKey;
        window.__maptilerApiKey = cfg.apiKey;
    }

    // Prevent SDK from mutating style language internally (avoids structuredClone on proxied data)
    try {
        maptilersdk.config.primaryLanguage = maptilersdk.toLanguageInfo('style_lock');
    } catch (_) {}
}

export function applyLocale(map, language, translations = {}, container) {
    if (language) {
        language = language.toLowerCase();
        if (language === 'arabic') language = 'ar';
        try {
            applyLanguageSafely(map, language);
        } catch (_) {}
    }
    if (translations && Object.keys(translations).length) {
        try {
            map.setLocale(translations);
        } catch {}
        if (container) {
            applyControlTranslations(container, translations, language);
        }
    }
}

// Minimal, clone-safe language application that avoids SDK's structuredClone usage
function applyLanguageSafely(map, language) {
    const style = map.getStyle && map.getStyle();
    if (!style || !Array.isArray(style.layers)) return;
    const flag = language === 'local' || language === 'style' ? 'name' : `name:${language}`;
    const host = 'api.maptiler.com';

    for (const layer of style.layers) {
        if (!layer || layer.type !== 'symbol') continue;
        const src = map.getSource(layer.source);
        if (!src || !('url' in src) || typeof src.url !== 'string') continue;
        try {
            const url = new URL(src.url);
            if (url.host !== host) continue;
        } catch (_) {
            continue;
        }
        const id = layer.id;
        const existing = map.getLayoutProperty(id, 'text-field');
        // Build a fresh expression, avoiding cloning any existing proxies
        const expr = ['coalesce', ['get', flag], ['get', 'name']];
        try {
            map.setLayoutProperty(id, 'text-field', expr);
        } catch (_) {}
    }
}

export function formatStyleName(name) {
    return name
        .replace(/\./g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
}

export function createMarkerElement(spec) {
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
}

export function createLock(cfg) {
    return {
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
            if (cfg.rateLimitEvent) {
                Livewire.dispatch(cfg.rateLimitEvent, {
                    statePath: cfg.statePath,
                    resetMs: ms,
                });
            }
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
            if (this.mapRef) {
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
}

export function createLimiters(limitCfg) {
    const interval = limitCfg.interval;
    return {
        geolocate: createRateLimiter(limitCfg.geolocate, interval),
        zoom: createRateLimiter(limitCfg.zoom, interval),
        pinMove: createRateLimiter(limitCfg.pinMove, interval),
        cameraMove: createRateLimiter(limitCfg.cameraMove, interval),
        search: createRateLimiter(limitCfg.search, interval),
    };
}

export function hookGeolocateButton({ container, geo, limiters, lock, lastFix, jumpTo, cacheMs }) {
    const btn = container.querySelector('.maplibregl-ctrl-geolocate');
    if (!btn || btn.dataset.geoGuarded === '1') return;
    let geoInFlight = false;
    const guard = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation?.();
        if (lock.isLocked()) return;
        const clickToken = limiters.geolocate.try();
        if (!clickToken.ok) {
            lock.lockFor(clickToken.resetMs);
            return;
        }
        const now = Date.now();
        const fix = typeof lastFix === 'function' ? lastFix() : lastFix;
        if (fix && fix.timestamp && now - fix.timestamp <= (cacheMs || Infinity) && jumpTo) {
            jumpTo({ lat: fix.lat, lng: fix.lng }, { zoom: 15 });
            return;
        }
        if (geoInFlight) return;
        const t = limiters.geolocate.try();
        if (!t.ok) {
            lock.lockFor(t.resetMs);
            return;
        }
        try {
            geoInFlight = true;
            geo.trigger();
        } catch (_) {}
    };
    btn.addEventListener('click', guard, { capture: true });
    btn.addEventListener(
        'keydown',
        (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') guard(ev);
        },
        { capture: true }
    );
    btn.dataset.geoGuarded = '1';
    geo.on('geolocate', () => (geoInFlight = false));
    geo.on('error', () => (geoInFlight = false));
}

export function addGeolocateControl(map, container, geoCfg, limiters, lock, { onGeolocate, lastFix, jumpTo } = {}) {
    const geo = new maptilersdk.GeolocateControl({
        trackUserLocation: true,
        positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 },
        fitBoundsOptions: { maxZoom: 15 },
    });
    map.addControl(geo, 'top-right');

    const hookOpts = { container, geo, limiters, lock };
    if (lastFix) hookOpts.lastFix = lastFix;
    if (jumpTo) hookOpts.jumpTo = jumpTo;
    if (geoCfg && typeof geoCfg.cacheInMs === 'number') hookOpts.cacheMs = geoCfg.cacheInMs;
    hookGeolocateButton(hookOpts);
    map.on('styledata', () => hookGeolocateButton(hookOpts));

    if (onGeolocate) {
        geo.on('geolocate', (e) => {
            if (lock.isLocked()) return;
            onGeolocate(e);
        });
    }

    if (geoCfg && geoCfg.runOnLoad) {
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

    return geo;
}

export function hookNavButtons(container, map, limiters, lock) {
    const inBtn = container.querySelector('.maplibregl-ctrl-zoom-in');
    const outBtn = container.querySelector('.maplibregl-ctrl-zoom-out');
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
}

export function hookInteractionGuards(container, map, limiters, lock) {
    map.__zoomTokenConsumed = false;
    map.__panTokenConsumed = false;
    let lastCenter = map.getCenter();
    let lastZoom = map.getZoom();
    let suppressZoom = false;

    const panStartGuardMouse = (ev) => {
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

    container.addEventListener('mousedown', panStartGuardMouse, { capture: true });
    container.addEventListener('pointerdown', panStartGuardPointer, { capture: true });
    container.addEventListener('touchstart', panStartGuardTouch, { passive: false, capture: true });

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
    container.addEventListener('wheel', onWheelDom, { passive: false, capture: true });

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

    container.addEventListener('touchstart', onTouchStartDom, { passive: false, capture: true });
    container.addEventListener('touchmove', onTouchMoveDom, { passive: false, capture: true });

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

    map.on('zoomend', () => {
        if (map.__zoomTokenConsumed) {
            map.__zoomTokenConsumed = false;
            lastZoom = map.getZoom();
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
            setTimeout(() => (map.__panTokenConsumed = false), 250);
        }
    };
    container.addEventListener('keydown', onKeyDown, { capture: true });

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

    map.on('dragend', () => {
        map.__panTokenConsumed = false;
        lastCenter = map.getCenter();
    });

    map.on('moveend', (e) => {
        if (lock.isLocked()) return;
        if (e.originalEvent) {
            lastCenter = map.getCenter();
        }
    });
}

export function addStyleSwitcherControl(map, styles, cfg, lock, setStyle) {
    let select;
    class TileControl {
        onAdd(mp) {
            this.map = mp;
            this.container = document.createElement('div');
            this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
            if (cfg.styleSwitcherLabel) {
                const label = document.createElement('label');
                label.textContent = cfg.styleSwitcherLabel;
                this.container.appendChild(label);
            }
            select = document.createElement('select');
            const keys = Object.keys(styles).filter((key) => {
                if (cfg.showSatelliteToggler && key === 'SATELLITE') return false;
                // Hide deprecated styles from the selector
                if (key === 'HYBRID') return false;
                return true;
            });
            keys.forEach((key) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = formatStyleName(key);
                if (key === cfg.style) option.selected = true;
                select.appendChild(option);
            });
            select.onchange = (e) => {
                if (lock && lock.isLocked()) return;
                if (cfg.showSatelliteToggler && cfg._satelliteActive) return;
                const name = e.target.value;
                if (setStyle) setStyle(name);
                else {
                    const style = styles[name] || styles['STREETS'];
                    map.setStyle(style);
                }
            };
            this.container.appendChild(select);
            return this.container;
        }
        onRemove() {
            if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
            this.map = undefined;
        }
    }
    map.addControl(new TileControl(), 'top-right');
    return select;
}

export function addSatelliteToggleControl(map, styles, cfg, lock, styleSelect, setStyle) {
    cfg._satelliteActive = false;
    class SatelliteControl {
        onAdd(mp) {
            this.map = mp;
            this.container = document.createElement('div');
            this.container.className = 'map-tiler-satellite-toggle maplibregl-ctrl maplibregl-ctrl-group';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '🛰️';
            btn.setAttribute('aria-label', 'Toggle satellite');
            btn.onclick = () => {
                if (lock && lock.isLocked()) return;
                if (!cfg._satelliteActive) {
                    this.lastStyle = cfg.style;
                    cfg._satelliteActive = true;
                    if (styleSelect) styleSelect.disabled = true;
                    if (setStyle) setStyle('SATELLITE');
                    else map.setStyle(styles['SATELLITE'] || styles['HYBRID'] || styles['STREETS']);
                    btn.classList.add('active');
                } else {
                    cfg._satelliteActive = false;
                    const target = this.lastStyle || 'STREETS';
                    if (setStyle) setStyle(target);
                    else {
                        const style = styles[target] || styles['STREETS'];
                        map.setStyle(style);
                    }
                    if (styleSelect) {
                        styleSelect.disabled = false;
                        styleSelect.value = target;
                    }
                    btn.classList.remove('active');
                }
            };
            this.container.appendChild(btn);
            return this.container;
        }
        onRemove() {
            if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
            this.map = undefined;
        }
    }
    map.addControl(new SatelliteControl(), 'top-right');
}

export async function tryReloadStyleWithBackoff(map, styles, cfg) {
    const delays = backoffDelays(5);
    for (let i = 0; i < delays.length; i++) {
        try {
            const style = styles[cfg.style] || styles['STREETS'];
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
}

export function attachWebglFailureProtection(map, styles, cfg, hardRefresh) {
    const reload = () =>
        tryReloadStyleWithBackoff(map, styles, cfg).then((ok) => {
            if (!ok && typeof hardRefresh === 'function') hardRefresh();
        });

    map.on('webglcontextlost', (e) => {
        e.preventDefault();
        reload();
    });
    let errorTimer = null;
    map.on('error', (evt) => {
        const err = evt && evt.error;
        if (!isTransientNetworkError(err)) return;
        if (errorTimer) clearTimeout(errorTimer);
        errorTimer = setTimeout(() => reload(), 150);
    });
    window.addEventListener('online', reload);
    document.addEventListener(
        'visibilitychange',
        () => {
            if (document.visibilityState === 'visible') reload();
        },
        { passive: true }
    );
}

function applyControlTranslations(container, dict = {}, language) {
    const rtl = language === 'ar';
    const set = (sel, key) => {
        const title = dict[key];
        const el = container.querySelector(sel);
        if (el && title) {
            el.setAttribute('title', title);
            el.setAttribute('aria-label', title);
            if (rtl) el.setAttribute('dir', 'rtl');
            else el.removeAttribute('dir');
        }
    };
    set('.maplibregl-ctrl-zoom-in', 'NavigationControl.ZoomIn');
    set('.maplibregl-ctrl-zoom-out', 'NavigationControl.ZoomOut');
    set('.maplibregl-ctrl-compass', 'NavigationControl.ResetBearing');
    set('.maplibregl-ctrl-pitchtoggle', 'NavigationControl.PitchUp');
    set('.maplibregl-ctrl-rotate-left', 'NavigationControl.RotateLeft');
    set('.maplibregl-ctrl-rotate-right', 'NavigationControl.RotateRight');
    set('.maplibregl-ctrl-fullscreen', 'FullscreenControl.Enter');
    set('.maplibregl-ctrl-geolocate', 'GeolocateControl.FindMyLocation');
}

export function applyLocaleIfNeeded() {
    applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer);
}

export function hardRefreshSoon() {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    this.recreateMapInstance();
}

export function setStyle(styleName) {
    if (this.lock && this.lock.isLocked && this.lock.isLocked()) return;
    this.config.style = styleName;
    let style = null;
    // Prefer precomputed styles map if present
    if (this.styles && typeof this.styles === 'object') {
        style = this.styles[styleName];
    }
    // Fallback: rebuild styles map on the fly
    if (!style) {
        try {
            const fallback = buildStyles(this.config?.customStyles || {});
            style = fallback[styleName] || fallback['STREETS'];
        } catch (_) {
            // Last resort: a safe default URL
            style = 'https://api.maptiler.com/maps/streets/style.json';
        }
    }
    // If style is a plain object (custom JSON), de-proxy it to avoid structuredClone/DataCloneError
    if (style && typeof style === 'object' && !Array.isArray(style)) {
        try {
            style = JSON.parse(JSON.stringify(style));
        } catch (_) {}
    }
    try {
        this.map.setStyle(style);
    } catch (err) {
        if (isTransientNetworkError(err)) this.hardRefreshSoon();
        else console.error('setStyle failed:', err);
    }
}

export function recreateMapInstance() {
    const center = this.marker ? this.marker.getLngLat() : null;
    const zoom = this.map ? this.map.getZoom() : this.config.initialZoomLevel;
    const styleName = this.config.style;
    try {
        this.map && this.map.remove();
    } catch (_) {}
    this.map = null;
    this.marker = null;

    this.initMap();

    if (center) {
        this.map.setCenter([center.lng, center.lat]);
        this.map.setZoom(zoom);
        this.marker.setLngLat([center.lng, center.lat]);
    }
    if (styleName) this.setStyle(styleName);
}

// Prevent SDK language warnings and null handling from bubbling to console
export function guardSdkLanguage(map, cfg) {
    try {
        // Prefer a locked mode so SDK won't try to localize on its own
        if (maptilersdk.Language && maptilersdk.Language.STYLE_LOCK) {
            map.primaryLanguage = maptilersdk.Language.STYLE_LOCK;
        }
    } catch (_) {}
    try {
        const orig = map.setPrimaryLanguage ? map.setPrimaryLanguage.bind(map) : null;
        if (orig) {
            map.setPrimaryLanguage = (info) => {
                // ignore null/undefined payloads that cause warnings
                if (info == null) return;
                // if our component manages language, skip SDK mutation
                if (cfg && cfg.language) return;
                try {
                    orig(info);
                } catch (_) {}
            };
        }
    } catch (_) {}
}
