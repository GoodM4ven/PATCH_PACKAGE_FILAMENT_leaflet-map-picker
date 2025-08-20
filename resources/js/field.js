import * as maptilersdk from '@maptiler/sdk';

export default function leafletMapPicker({ location, config }) {
    return {
        map: null,
        marker: null,
        lat: null,
        lng: null,
        location: null,
        config: {
            draggable: true,
            clickable: true,
            defaultZoom: 13,
            defaultLocation: {
                lat: 41.0082,
                lng: 28.9784,
            },
            myLocationButtonLabel: '',
            searchLocationButtonLabel: '',
            statePath: '',
            tileProvider: 'STREETS',
            customTiles: [],
            customMarker: null,
            searchQuery: '',
            localSearchResults: [],
            isSearching: false,
            searchTimeout: null,
            is_disabled: false,
            showTileControl: true,
            apiKey: '',
        },

        tileProviders: {
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
            maptilersdk.config.apiKey = this.config.apiKey;

            if (this.config.customTiles && Object.keys(this.config.customTiles).length > 0) {
                this.tileProviders = { ...this.tileProviders, ...this.config.customTiles };
            }

            this.initMap();
            this.$watch('location', () => this.updateMapFromAlpine());
        },

        initMap() {
            const coords = [this.getCoordinates().lng, this.getCoordinates().lat];

            this.map = new maptilersdk.Map({
                container: this.$refs.mapContainer,
                style: this.tileProviders[this.config.tileProvider] || maptilersdk.MapStyle.STREETS,
                center: coords,
                zoom: this.config.defaultZoom,
            });

            const markerOptions = { draggable: this.config.draggable };
            if (this.config.customMarker) {
                markerOptions.element = this.createMarkerElement(this.config.customMarker);
            }
            this.marker = new maptilersdk.Marker(markerOptions).setLngLat(coords).addTo(this.map);

            this.lat = this.getCoordinates().lat;
            this.lng = this.getCoordinates().lng;
            this.setCoordinates(this.getCoordinates());

            if (this.config.clickable) {
                this.map.on('click', (e) => {
                    this.markerMoved({ latLng: e.lngLat });
                });
            }

            if (this.config.draggable) {
                this.marker.on('dragend', () => {
                    const pos = this.marker.getLngLat();
                    this.markerMoved({ latLng: pos });
                });
            }

            if (! this.config.is_disabled) {
                this.addLocationButton();
                this.addSearchButton();
            }

            if (this.config.showTileControl) {
                this.addTileSelectorControl();
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

        addSearchButton() {
            const self = this;
            class SearchControl {
                onAdd(map) {
                    this.map = map;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>`;
                    btn.title = self.config.searchLocationButtonLabel || 'Search Location';
                    btn.onclick = () => self.$dispatch('open-modal', { id: 'location-search-modal' });
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    this.container.parentNode.removeChild(this.container);
                    this.map = undefined;
                }
            }
            this.map.addControl(new SearchControl(), 'top-left');
        },

        debounceSearch() {
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }

            if (!this.searchQuery || this.searchQuery.length < 3) {
                this.localSearchResults = [];
                this.isSearching = false;
                return;
            }

            this.isSearching = true;
            this.searchTimeout = setTimeout(() => {
                this.searchLocationFromModal(this.searchQuery);
            }, 500);
        },

        async searchLocationFromModal(query) {
            if (!query || query.length < 3) {
                this.isSearching = false;
                return;
            }

            try {
                const results = await maptilersdk.geocoding.forward(query);
                this.localSearchResults = results.features;
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                this.isSearching = false;
            }
        },

        selectLocationFromModal(result) {
            const [lng, lat] = result.center || result.geometry.coordinates;
            this.map.setCenter([lng, lat]);
            this.map.setZoom(15);
            this.marker.setLngLat([lng, lat]);
            this.lat = lat;
            this.lng = lng;
            this.localSearchResults = [];
            this.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
        },

        setStyle(styleName) {
            const style = this.tileProviders[styleName] || maptilersdk.MapStyle.STREETS;
            this.map.setStyle(style);
        },

        addTileSelectorControl() {
            const self = this;
            class TileControl {
                onAdd(map) {
                    this.map = map;
                    this.container = document.createElement('div');
                    this.container.className = 'leaflet-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
                    const label = document.createElement('label');
                    label.textContent = self.config.map_type_text;
                    const select = document.createElement('select');
                    Object.keys(self.tileProviders).forEach(key => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = self.formatProviderName(key);
                        if (key === self.config.tileProvider) option.selected = true;
                        select.appendChild(option);
                    });
                    select.onchange = (e) => self.setStyle(e.target.value);
                    this.container.appendChild(label);
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

        formatProviderName(name) {
            return name
                .replace(/\./g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, str => str.toUpperCase())
                .trim();
        },

        addLocationButton() {
            const self = this;
            class LocationControl {
                onAdd(map) {
                    this.map = map;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>`;
                    btn.title = self.config.myLocationButtonLabel;
                    btn.onclick = () => self.goToCurrentLocation();
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    this.container.parentNode.removeChild(this.container);
                    this.map = undefined;
                }
            }
            this.map.addControl(new LocationControl(), 'top-left');
        },

        goToCurrentLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const latLng = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                        };
                        this.setCoordinates(latLng);
                        this.marker.setLngLat([latLng.lng, latLng.lat]);
                        this.map.easeTo({ center: [latLng.lng, latLng.lat], zoom: 15 });
                        this.lat = latLng.lat;
                        this.lng = latLng.lng;
                    },
                    (error) => {
                        new FilamentNotification().title('Error').body('Could not get location. Please check console errors').danger().send();
                        console.error('Error getting location:', error);
                    }
                );
            } else {
                new FilamentNotification().title('No Browser Support').body('Your browser does not support location services').danger().send();
            }
        },

        markerMoved(event) {
            const position = event.latLng;
            this.lat = position.lat;
            this.lng = position.lng;
            this.setCoordinates({ lat: this.lat, lng: this.lng });
            this.marker.setLngLat([this.lng, this.lat]);
            this.map.easeTo({ center: [this.lng, this.lat] });
        },

        updateMapFromAlpine() {
            const location = this.getCoordinates();
            const markerPosition = this.marker.getLngLat();
            if (location.lat !== markerPosition.lat || location.lng !== markerPosition.lng) {
                this.updateMap(location);
            }
        },

        updateMap(position) {
            this.marker.setLngLat([position.lng, position.lat]);
            this.map.easeTo({ center: [position.lng, position.lat] });
            this.lat = position.lat;
            this.lng = position.lng;
        },

        setCoordinates(position) {
            this.$wire.set(this.config.statePath, position);
        },

        getCoordinates() {
            let location = this.$wire.get(this.config.statePath);
            if (!location || !location.lat || !location.lng) {
                location = { lat: this.config.defaultLocation.lat, lng: this.config.defaultLocation.lng };
            }
            return location;
        },
    };
}
