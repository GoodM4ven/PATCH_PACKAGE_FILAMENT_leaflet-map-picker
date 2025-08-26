import * as maptilersdk from '@maptiler/sdk';
import { createRateLimiter, ensureOverlay, ensureCountdownBanner } from './helpers.js';

export function buildStyles(customStyles = {}) {
    const base = {
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
    return { ...base, ...customStyles };
}

export function setupSdk(cfg) {
    if (cfg.language) cfg.language = cfg.language.toLowerCase();

    if (!cfg.apiKey) throw new Error('MapTiler API key is required');

    if (!window.__maptilerApiKey || window.__maptilerApiKey !== cfg.apiKey) {
        maptilersdk.config.apiKey = cfg.apiKey;
        window.__maptilerApiKey = cfg.apiKey;
    }

    if (cfg.language) {
        const lang = maptilersdk.Language[cfg.language] || cfg.language;
        maptilersdk.config.primaryLanguage = lang;
    }
}

export function applyLocale(map, language, translations = {}, container) {
    if (!language) return;
    const primary = maptilersdk.Language[language] || language;
    try {
        map.setLanguage(primary);
    } catch {}
    if (translations && Object.keys(translations).length) {
        try {
            map.setLocale(translations);
        } catch {}
        if (language === 'ar' && container) {
            forceArabicTitlesFallback(container, translations);
        }
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

function forceArabicTitlesFallback(container, dict = {}) {
    const set = (sel, title) => {
        const el = container.querySelector(sel);
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
}
