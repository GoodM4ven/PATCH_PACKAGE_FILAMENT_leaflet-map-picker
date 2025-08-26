import * as maptilersdk from '@maptiler/sdk';
import {
    buildStyles,
    setupSdk,
    createLock,
    createLimiters,
    createMarkerElement,
    hookGeolocateButton,
    hookNavButtons,
    hookInteractionGuards,
    addStyleSwitcherControl,
    attachWebglFailureProtection,
    applyLocaleIfNeeded,
    setStyle,
    hardRefreshSoon,
    recreateMapInstance,
} from './map-features.js';

export default function mapTilerEntry({ location, config }) {
    const cfg = config;
    setupSdk(cfg);
    const limiters = createLimiters(cfg.rateLimit);

    return {
        map: null,
        marker: null,
        location: null,
        config: cfg,

        styles: {},
        lock: createLock(cfg),

        init() {
            this.location = location;
            this.lock.initUI(this.$refs.mapContainer);
            this.styles = buildStyles(this.config.customStyles);
            this.initMap();
        },

        initMap() {
            const coords = [this.getCoordinates().lng, this.getCoordinates().lat];

            const mapOptions = {
                container: this.$refs.mapContainer,
                style: this.styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center: coords,
                zoom: this.config.defaultZoom,
                minZoom: this.config.minZoomLevel ?? undefined,
                maxZoom: this.config.maxZoomLevel ?? undefined,
                hash: !!this.config.hash,
                maxBounds: this.config.maxBounds || undefined,
            };

            this.lock.attachMap((this.map = new maptilersdk.Map(mapOptions)));
            const containerEl = this.map.getCanvasContainer?.() || this.map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, this.map, limiters, this.lock);

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            if (this.config.showStyleSwitcher) {
                addStyleSwitcherControl(this.map, this.styles, this.config, this.lock, (s) => this.setStyle(s));
            }
            if (this.config.rotationable || this.config.zoomable) {
                this.map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: this.config.rotationable,
                        showZoom: this.config.zoomable,
                        visualizePitch: this.config.rotationable,
                    }),
                    'top-right'
                );
                hookNavButtons(containerEl, this.map, limiters, this.lock);
                this.map.on('styledata', () => hookNavButtons(containerEl, this.map, limiters, this.lock));
            }
            if (!this.config.rotationable) {
                this.map.dragRotate.disable();
                this.map.touchZoomRotate.disableRotation();
            }
            if (!this.config.zoomable) {
                this.map.scrollZoom.disable();
                this.map.boxZoom.disable();
                this.map.doubleClickZoom.disable();
                this.map.touchZoomRotate.disable();
                this.map.keyboard.disable();
            }

            const geoCfg = this.config.geolocate;
            if (geoCfg.enabled) {
                const geo = new maptilersdk.GeolocateControl({
                    trackUserLocation: true,
                    positionOptions: { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 },
                    fitBoundsOptions: { maxZoom: 15 },
                });
                this.map.addControl(geo, 'top-right');
                hookGeolocateButton({ container: containerEl, geo, limiters, lock: this.lock });
                geo.on('geolocate', (e) => {
                    if (this.lock.isLocked()) return;
                    const { latitude, longitude } = e.coords;
                    this.map.jumpTo({ center: [longitude, latitude], zoom: Math.max(this.map.getZoom(), 15) });
                });
                if (geoCfg.runOnLoad) {
                    this.map.on('load', () => {
                        if (this.lock.isLocked()) return;
                        const t = limiters.geolocate.try();
                        if (!t.ok) {
                            this.lock.lockFor(t.resetMs);
                            return;
                        }
                        try {
                            geo.trigger();
                        } catch (_) {}
                    });
                }
            }

            this.map.on('load', () => this.applyLocaleIfNeeded());
            this.map.on('styledata', () => this.applyLocaleIfNeeded());
            this.map.on('styleimagemissing', () => {});
            attachWebglFailureProtection(this.map, this.styles, this.config, () => this.hardRefreshSoon());
        },

        setStyle,
        hardRefreshSoon,
        recreateMapInstance,
        applyLocaleIfNeeded,

        getCoordinates() {
            let locationObj = this.location;
            if (typeof locationObj === 'string') {
                try {
                    locationObj = JSON.parse(locationObj);
                } catch (e) {
                    locationObj = null;
                }
            }

            if (!locationObj || !locationObj.lat || !locationObj.lng) {
                locationObj = {
                    lat: this.config.defaultLocation.lat,
                    lng: this.config.defaultLocation.lng,
                };
            }

            return locationObj;
        },
    };
}

