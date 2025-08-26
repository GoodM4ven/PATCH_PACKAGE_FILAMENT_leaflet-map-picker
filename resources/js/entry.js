import * as maptilersdk from '@maptiler/sdk';
import { buildStyles, applyLocale, setupSdk } from './map-features.js';

export default function mapTilerEntry({ location, config }) {
    return {
        map: null,
        marker: null,
        location: null,
        config,

        styles: {},

        init() {
            this.location = location;
            setupSdk(this.config);
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

            this.map = new maptilersdk.Map(mapOptions);

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = this.createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            if (this.config.showStyleSwitcher) {
                this.addStyleSwitcherControl();
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
                geo.on('geolocate', (e) => {
                    const { latitude, longitude } = e.coords;
                    this.map.jumpTo({ center: [longitude, latitude], zoom: Math.max(this.map.getZoom(), 15) });
                });
                if (geoCfg.runOnLoad) {
                    this.map.on('load', () => {
                        try { geo.trigger(); } catch (_) {}
                    });
                }
            }

            this.map.on('load', () => applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer));
            this.map.on('styledata', () => applyLocale(this.map, this.config.language, this.config.controlTranslations, this.$refs.mapContainer));
        },

        createMarkerElement(options) {
            const el = document.createElement('div');
            if (options.className) el.className = options.className;
            if (options.iconUrl) {
                el.style.backgroundImage = `url('${options.iconUrl}')`;
                el.style.width = (options.iconSize?.[0] || 25) + 'px';
                el.style.height = (options.iconSize?.[1] || 41) + 'px';
                el.style.backgroundSize = 'contain';
            }
            return el;
        },

        setStyle(styleName) {
            const style = this.styles[styleName] || maptilersdk.MapStyle.STREETS;
            this.map.setStyle(style);
        },

        addStyleSwitcherControl() {
            const self = this;
            class TileControl {
                onAdd(map) {
                    this.map = map;
                    this.container = document.createElement('div');
                    this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
                    const select = document.createElement('select');
                    Object.keys(self.styles).forEach(key => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = self.formatStyleName(key);
                        if (key === self.config.style) option.selected = true;
                        select.appendChild(option);
                    });
                    select.onchange = e => self.setStyle(e.target.value);
                    this.container.appendChild(select);
                    return this.container;
                }
                onRemove() {
                    this.container.parentNode.removeChild(this.container);
                    this.map = undefined;
                }
            }
            this.map.addControl(new TileControl(), 'top-right');
        },

        formatStyleName(name) {
            return name
                .replace(/\./g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, str => str.toUpperCase())
                .trim();
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
