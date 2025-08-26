import * as maptilersdk from '@maptiler/sdk';
import {
    buildStyles,
    applyLocale,
    setupSdk,
    createLock,
    createLimiters,
    createMarkerElement,
    hookGeolocateButton,
    hookNavButtons,
    hookInteractionGuards,
    addStyleSwitcherControl,
} from './map-features.js';

export default function mapTilerEntry({ location, config }) {
    const cfg = config;
    setupSdk(cfg);
    const lock = createLock(cfg);
    const limiters = createLimiters(cfg.rateLimit);
    return {
        map: null,
        marker: null,
        location: null,
        config: cfg,

        styles: {},

        init() {
            this.location = location;
            lock.initUI(this.$refs.mapContainer);
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

            lock.attachMap(this.map = new maptilersdk.Map(mapOptions));
            const containerEl = this.map.getCanvasContainer?.() || this.map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, this.map, limiters, lock);

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            if (this.config.showStyleSwitcher) {
                addStyleSwitcherControl(this.map, this.styles, this.config, lock, (s) => this.setStyle(s));
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
                hookNavButtons(containerEl, this.map, limiters, lock);
                this.map.on('styledata', () => hookNavButtons(containerEl, this.map, limiters, lock));
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
                hookGeolocateButton({ container: containerEl, geo, limiters, lock });
                geo.on('geolocate', (e) => {
                    if (lock.isLocked()) return;
                    const { latitude, longitude } = e.coords;
                    this.map.jumpTo({ center: [longitude, latitude], zoom: Math.max(this.map.getZoom(), 15) });
                });
                if (geoCfg.runOnLoad) {
                    this.map.on('load', () => {
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

            this.map.on('load', () => applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer));
            this.map.on('styledata', () => applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer));
        },

        setStyle(styleName) {
            const style = this.styles[styleName] || maptilersdk.MapStyle.STREETS;
            this.map.setStyle(style);
        },


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
