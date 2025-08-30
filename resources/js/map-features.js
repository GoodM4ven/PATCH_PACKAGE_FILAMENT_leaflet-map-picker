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

    // Force SDK to not mutate labels automatically; we handle localization ourselves.
    try {
        maptilersdk.config.primaryLanguage = maptilersdk.toLanguageInfo('style_lock');
    } catch (_) {}
}

export function applyLocale(map, language, translations = {}, container, styleKey = null) {
    // Only apply control translations; skip label rewrites entirely to avoid style mutation issues
    const lang = language ? String(language).toLowerCase() : null;
    if (translations && Object.keys(translations).length) {
        try { map.setLocale(translations); } catch (_) {}
        if (container) applyControlTranslations(container, translations, lang);
    }
}

// Minimal, clone-safe language application that avoids SDK's structuredClone usage
function applyLanguageSafely(map, language) {
    const style = map.getStyle && map.getStyle();
    if (!style || !Array.isArray(style.layers)) return;
    const flag = language === 'local' || language === 'style' ? 'name' : `name:${language}`;
    const host = 'api.maptiler.com';

    const containsNameToken = (val) => {
        if (!val) return false;
        if (typeof val === 'string') return /\{name(?::[^}]+)?\}/.test(val) || val.trim() === '{name}';
        if (Array.isArray(val)) {
            // Expression like ['get','name'] or ['get','name:ar'] or nested format/concat with such
            if (val.length >= 2 && val[0] === 'get' && typeof val[1] === 'string' && val[1].startsWith('name')) return true;
            for (const v of val) if (containsNameToken(v)) return true;
        }
        return false;
    };

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
        // Only override if the layer already has a text-field referencing {name...}
        if (existing === undefined || existing === null) continue;
        if (!containsNameToken(existing)) continue;
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
        styleSwitch: createRateLimiter(limitCfg.styleSwitch, interval),
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

export function addSatelliteToggleControl(map, styles, cfg, lock, limiters, streetToggleEl, setStyle) {
    cfg._satelliteActive = false;
    class SatelliteControl {
        onAdd(mp) {
            this.map = mp;
            this.container = document.createElement('div');
            this.container.className = 'map-tiler-satellite-toggle maplibregl-ctrl maplibregl-ctrl-group';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.display = 'grid';
            btn.style.justifyContent = 'center';
            btn.style.alignItems = 'center';
            btn.setAttribute('aria-label', 'Toggle satellite');
            const setIcon = () => {
                if (cfg._satelliteActive) {
                    // Active icon
                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"></path><path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z"></path></svg>';
                } else {
                    // Inactive icon
                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"></path><path d="M14 6l-4.22 5.63 1.25 1.67L14 9.33 19 16h-8.46l-4.01-5.37L1 18h22L14 6zM5 16l1.52-2.03L8.04 16H5z"></path></svg>';
                }
            };
            setIcon();
            btn.onclick = () => {
                if (lock && lock.isLocked()) return;
                if (typeof this.map._styleInFlight === 'boolean' ? this.map._styleInFlight : cfg._styleInFlight) return;
                const token = limiters && limiters.styleSwitch ? limiters.styleSwitch.try() : { ok: true };
                if (!token.ok) { lock && lock.lockFor(token.resetMs); return; }
                if (!cfg._satelliteActive) {
                    this.lastStyle = cfg.style;
                    cfg._satelliteActive = true;
                    if (streetToggleEl) streetToggleEl.style.display = 'none';
                    if (setStyle) setStyle('SATELLITE');
                    else map.setStyle(styles['SATELLITE'] || styles['STREETS']);
                    btn.classList.add('active');
                    setIcon();
                } else {
                    cfg._satelliteActive = false;
                    const target = this.lastStyle || 'STREETS';
                    if (setStyle) setStyle(target);
                    else {
                        const style = styles[target] || styles['STREETS'];
                        map.setStyle(style);
                    }
                    if (streetToggleEl) streetToggleEl.style.display = '';
                    btn.classList.remove('active');
                    setIcon();
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

export function addStreetThemeToggleControl(map, styles, cfg, lock, limiters, setStyle) {
    cfg._streetDarkActive = cfg.style === 'STREETS.DARK';
    class StreetThemeControl {
        onAdd(mp) {
            this.map = mp;
            this.container = document.createElement('div');
            this.container.className = 'map-tiler-street-theme maplibregl-ctrl maplibregl-ctrl-group';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.display = 'grid';
            btn.style.justifyContent = 'center';
            btn.style.alignItems = 'center';
            const setIcon = () => {
                btn.innerHTML = cfg._streetDarkActive
                    ? '<svg class="w-4 h-4 stroke-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg>'
                    : '<svg class="w-4 h-4 stroke-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"/></svg>';
            };
            setIcon();
            btn.onclick = () => {
                if (lock && lock.isLocked()) return;
                if (cfg._satelliteActive) return;
                if (typeof this.map._styleInFlight === 'boolean' ? this.map._styleInFlight : cfg._styleInFlight) return;
                const token = limiters && limiters.styleSwitch ? limiters.styleSwitch.try() : { ok: true };
                if (!token.ok) { lock && lock.lockFor(token.resetMs); return; }
                cfg._streetDarkActive = !cfg._streetDarkActive;
                setIcon();
                const target = cfg._streetDarkActive ? 'STREETS.DARK' : 'STREETS';
                if (setStyle) setStyle(target);
                else map.setStyle(styles[target] || styles['STREETS']);
            };
            this.container.appendChild(btn);
            return this.container;
        }
        onRemove() {
            if (this.container && this.container.parentNode) this.container.parentNode.removeChild(this.container);
            this.map = undefined;
        }
    }
    const ctrl = new StreetThemeControl();
    map.addControl(ctrl, 'top-right');
    return ctrl.container;
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
    applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer, this.config.style);
}

export function hardRefreshSoon() {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.onLine) return;
    this.recreateMapInstance();
}

export function setStyle(styleName) {
    if (this.lock && this.lock.isLocked && this.lock.isLocked()) return;
    if (this._styleInFlight) return;
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
    // Switch style with full replace (diff: false) and wait for idle to avoid mid-diff glitches
    const doSwitch = () => {
        try { this.map.stop?.(); } catch (_) {}
        try {
            this._styleInFlight = true;
            this.map.setStyle(style, { diff: false });
        } catch (err) {
            this._styleInFlight = false;
            if (isTransientNetworkError(err)) this.hardRefreshSoon();
            else console.error('setStyle failed:', err);
            return;
        }
        const release = () => { this._styleInFlight = false; };
        const onIdle = () => {
            this.map.off?.('idle', onIdle);
            release();
        };
        try { this.map.once('idle', onIdle); } catch (_) { release(); }
        // Fallback release in case idle never fires
        setTimeout(() => release(), 2000);
    };
    doSwitch();
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
    // Intercept SDK language APIs to avoid proxy/clone issues; reroute to our safe rewrite
    const toLangCode = (val) => {
        try {
            const info = maptilersdk.toLanguageInfo(val);
            if (info && typeof info.flag === 'string') {
                if (info.flag === 'name') return 'local';
                if (info.flag.startsWith('name:')) return info.flag.split(':')[1];
                return 'style';
            }
        } catch (_) {}
        if (typeof val === 'string') return val.toLowerCase();
        return null;
    };
    try {
        map.setLanguage = (val) => {
            const code = toLangCode(val) || (cfg && cfg.language ? String(cfg.language).toLowerCase() : null);
            if (!code) return;
            try {
                map.once('idle', () => applyLanguageSafely(map, code));
            } catch (_) {
                try { applyLanguageSafely(map, code); } catch (_) {}
            }
        };
    } catch (_) {}
    try {
        map.setPrimaryLanguage = (val) => {
            const code = toLangCode(val) || (cfg && cfg.language ? String(cfg.language).toLowerCase() : null);
            if (!code) return;
            try {
                map.once('idle', () => applyLanguageSafely(map, code));
            } catch (_) {
                try { applyLanguageSafely(map, code); } catch (_) {}
            }
        };
    } catch (_) {}
}

// Suppress a known benign MapLibre startup console error about proxy 'rgb'
// Only active briefly during initial style load, then restored automatically.
export function suppressBenignStartupErrors(map, timeoutMs = 4000) {
    if (typeof window === 'undefined') return;
    const isBenign = (msg) => {
        try {
            const s = String(msg || '');
            return s.includes("property 'rgb'") && s.includes('proxy');
        } catch (_) {
            return false;
        }
    };

    // 1) window.onerror filter
    const prevOnError = window.onerror;
    const onErrorHandler = function (message, source, lineno, colno, error) {
        const msg = message || (error && error.message);
        if (isBenign(msg)) return true;
        return prevOnError ? prevOnError.apply(this, arguments) : false;
    };
    window.onerror = onErrorHandler;

    // 2) console.error/warn filter
    const prevConsoleError = console.error;
    const prevConsoleWarn = console.warn;
    console.error = function (...args) {
        if (args.length && isBenign(args[0])) return;
        return prevConsoleError.apply(this, args);
    };
    console.warn = function (...args) {
        if (args.length && isBenign(args[0])) return;
        return prevConsoleWarn.apply(this, args);
    };

    const restore = () => {
        if (window.onerror === onErrorHandler) window.onerror = prevOnError || null;
        if (console.error === onErrorHandler) {
            // never true, separate function; but keep for safety
        }
        console.error = prevConsoleError;
        console.warn = prevConsoleWarn;
    };
    try { map.once('idle', restore); } catch (_) {}
    setTimeout(restore, timeoutMs);
}
