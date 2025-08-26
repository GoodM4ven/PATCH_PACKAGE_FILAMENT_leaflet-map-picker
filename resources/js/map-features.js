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
    if (cfg.language) {
        cfg.language = cfg.language.toLowerCase();
        if (cfg.language === 'arabic') cfg.language = 'ar';
    }

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
    if (language) {
        language = language.toLowerCase();
        if (language === 'arabic') language = 'ar';
        const primary = maptilersdk.Language[language] || language;
        try {
            map.setLanguage(primary);
        } catch {}
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
    class TileControl {
        onAdd(mp) {
            this.map = mp;
            this.container = document.createElement('div');
            this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
            if (cfg.style_switcher_label) {
                const label = document.createElement('label');
                label.textContent = cfg.style_switcher_label;
                this.container.appendChild(label);
            }
            const select = document.createElement('select');
            Object.keys(styles).forEach((key) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = formatStyleName(key);
                if (key === cfg.style) option.selected = true;
                select.appendChild(option);
            });
            select.onchange = (e) => {
                if (lock && lock.isLocked()) return;
                const name = e.target.value;
                if (setStyle) setStyle(name);
                else {
                    const style = styles[name] || maptilersdk.MapStyle.STREETS;
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
}

export async function tryReloadStyleWithBackoff(map, styles, cfg) {
    const delays = backoffDelays(5);
    for (let i = 0; i < delays.length; i++) {
        try {
            const style = styles[cfg.style] || maptilersdk.MapStyle.STREETS;
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
    const style = this.styles[styleName] || maptilersdk.MapStyle.STREETS;
    try {
        this.map.setStyle(style);
    } catch (err) {
        if (isTransientNetworkError(err)) this.hardRefreshSoon();
        else console.error('setStyle failed:', err);
    }
}

export function recreateMapInstance() {
    const center = this.marker ? this.marker.getLngLat() : null;
    const zoom = this.map ? this.map.getZoom() : this.config.defaultZoom;
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
