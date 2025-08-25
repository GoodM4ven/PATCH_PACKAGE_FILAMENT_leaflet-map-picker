import * as maptilersdk from '@maptiler/sdk';

export function buildStyles(customTiles = {}) {
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
    return { ...base, ...customTiles };
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
