import * as maptilersdk from '@maptiler/sdk';
import { buildStyles, applyLocale } from './map-features.js';

export default function mapTilerEntry({ location, config }) {
    return {
        map: null,
        marker: null,
        location: null,
        config,

        styles: {},

        init() {
            this.location = location;
            if (this.config.language) this.config.language = this.config.language.toLowerCase();
            if (!this.config.apiKey) {
                throw new Error('MapTiler API key is required');
            }
            if (!window.__maptilerApiKey || window.__maptilerApiKey !== this.config.apiKey) {
                maptilersdk.config.apiKey = this.config.apiKey;
                window.__maptilerApiKey = this.config.apiKey;
            }
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                maptilersdk.config.primaryLanguage = lang;
            }

            this.styles = buildStyles(this.config.customTiles);
            this.initMap();
        },

        initMap() {
            const coords = [this.getCoordinates().lng, this.getCoordinates().lat];

            const mapOptions = {
                container: this.$refs.mapContainer,
                style: this.styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center: coords,
                zoom: this.config.defaultZoom,
                interactive: false,
            };
            if (this.config.hash) mapOptions.hash = true;
            if (this.config.maxBounds) mapOptions.maxBounds = this.config.maxBounds;

            this.map = new maptilersdk.Map(mapOptions);

            if (this.config.geolocate?.enabled) {
                const ctrlContainer = this.map.getContainer().querySelector('.maplibregl-ctrl-top-right');
                if (ctrlContainer) ctrlContainer.innerHTML = '';
                const geo = new maptilersdk.GeolocateControl();
                this.map.addControl(geo, 'top-right');
                this.map.on('load', () => geo.trigger());
            }

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = this.createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            if (this.config.showStyleSwitcher) {
                this.addStyleSwitcherControl();
            }
            if (!this.config.rotationable) {
                this.map.dragRotate.disable();
                this.map.touchZoomRotate.disableRotation();
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
