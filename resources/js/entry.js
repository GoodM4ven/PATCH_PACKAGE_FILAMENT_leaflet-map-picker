import * as maptilersdk from '@maptiler/sdk';

export default function mapTilerEntry({ location, config }) {
    return {
        map: null,
        marker: null,
        location: null,
        config: {
            defaultZoom: 13,
            defaultLocation: { lat: 41.0082, lng: 28.9784 },
            style: 'STREETS',
            customTiles: [],
            customMarker: null,
            showStyleSwitcher: false,
            markerIconPath: '',
            markerShadowPath: '',
            apiKey: '',
            disableRotation: false,
            hash: false,
            maxBounds: null,
            language: null,
            geolocate: false,
        },

        styles: {
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
        },

        init() {
            this.location = location;
            this.config = { ...this.config, ...config };
            if (!this.config.apiKey) {
                throw new Error('MapTiler API key is required');
            }
            maptilersdk.config.apiKey = this.config.apiKey;
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                maptilersdk.config.primaryLanguage = lang;
            }

            if (this.config.customTiles && Object.keys(this.config.customTiles).length > 0) {
                this.styles = { ...this.styles, ...this.config.customTiles };
            }

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

            if (this.config.geolocate) {
                const geo = new maptilersdk.GeolocateControl();
                this.map.addControl(geo);
                geo.trigger();
            }

            const markerOptions = {};
            if (this.config.customMarker) {
                markerOptions.element = this.createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            if (this.config.showStyleSwitcher) {
                this.addStyleSwitcherControl();
            }
            if (this.config.disableRotation) {
                this.map.dragRotate.disable();
                this.map.touchZoomRotate.disableRotation();
            }
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                this.map.on('load', () => this.map.setLanguage(lang));
            }
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
