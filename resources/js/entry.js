import * as maptilersdk from '@maptiler/sdk';
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
    addSatelliteToggleControl,
    attachWebglFailureProtection,
    applyLocaleIfNeeded,
    setStyle,
    hardRefreshSoon,
    recreateMapInstance,
    guardSdkLanguage,
} from './map-features.js';

export default function mapTilerEntry({ location, config }) {
    const cfg = config;
    setupSdk(cfg);
    const limiters = createLimiters(cfg.rateLimits);

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
                style: this.styles[this.config.style] || this.styles['STREETS'],
                center: coords,
                zoom: this.config.initialZoomLevel,
                minZoom: this.config.minZoomLevel ?? undefined,
                maxZoom: this.config.maxZoomLevel ?? undefined,
                hash: !!this.config.hash,
                maxBounds: this.config.maxBounds || undefined,
            };

            this.lock.attachMap((this.map = new maptilersdk.Map(mapOptions)));
            try { guardSdkLanguage(this.map, this.config); } catch (_) {}
            const containerEl = this.map.getCanvasContainer?.() || this.map.getCanvas?.() || this.$refs.mapContainer;
            hookInteractionGuards(containerEl, this.map, limiters, this.lock);

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            let styleSelect;
            if (this.config.showStyleSwitcher) {
                styleSelect = addStyleSwitcherControl(
                    this.map,
                    this.styles,
                    this.config,
                    this.lock,
                    (s) => this.setStyle(s)
                );
            }
            if (this.config.showSatelliteToggler) {
                addSatelliteToggleControl(
                    this.map,
                    this.styles,
                    this.config,
                    this.lock,
                    styleSelect,
                    (s) => this.setStyle(s)
                );
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
                addGeolocateControl(
                    this.map,
                    containerEl,
                    geoCfg,
                    limiters,
                    this.lock,
                    {
                        onGeolocate: (e) => {
                            const { latitude, longitude } = e.coords;
                            this.map.jumpTo({ center: [longitude, latitude], zoom: Math.max(this.map.getZoom(), 15) });
                        },
                    }
                );
            }

            this.map.on('load', () => this.applyLocaleIfNeeded());
            // No 'styledata' handler; applyLocaleIfNeeded defers to 'idle'
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
