import * as maptilersdk from '@maptiler/sdk';
// [ignore] ensure your bundler transpiles optional-chaining or avoid it

export default function mapTilerPicker({ config }) {
    // keep heavy/circular refs OUT of Alpine state
    let map = null;
    let marker = null;
    let tileProviders = null;

    return {
        // LIGHTWEIGHT, serializable state only
        lat: null,
        lng: null,
        config: {
            draggable: true,
            clickable: true,
            defaultZoom: 13,
            defaultLocation: { lat: 41.0082, lng: 28.9784 },
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
            map_type_text: 'Map Type',
        },

        init() {
            // merge server config
            this.config = { ...this.config, ...config };

            if (!this.config.apiKey) throw new Error('MapTiler API key is required');
            maptilersdk.config.apiKey = this.config.apiKey;

            // build tile providers LOCALLY (not on `this`)
            tileProviders = {
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

            // merge any custom tiles
            if (this.config.customTiles && Object.keys(this.config.customTiles).length > 0) {
                tileProviders = { ...tileProviders, ...this.config.customTiles };
            }

            this.initMap();
        },

        initMap() {
            const initial = { ...this.getCoordinates() };
            const center = [initial.lng, initial.lat];

            map = new maptilersdk.Map({
                container: this.$refs.mapContainer,
                style: tileProviders[this.config.tileProvider] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: this.config.defaultZoom,
            });

            const markerOptions = { draggable: this.config.draggable };
            if (this.config.customMarker) markerOptions.element = this.createMarkerElement(this.config.customMarker);

            marker = new maptilersdk.Marker(markerOptions).setLngLat(center).addTo(map);

            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            if (this.config.clickable) {
                map.on('click', (e) => this.markerMoved({ latLng: e.lngLat }));
            }

            if (this.config.draggable) {
                marker.on('dragend', () => {
                    const pos = marker.getLngLat();
                    this.markerMoved({ latLng: pos });
                });
            }

            if (!this.config.is_disabled) {
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
                const w = options.iconSize && options.iconSize[0] ? options.iconSize[0] : 25;
                const h = options.iconSize && options.iconSize[1] ? options.iconSize[1] : 41;
                el.style.width = w + 'px';
                el.style.height = h + 'px';
                el.style.backgroundSize = 'contain';
            }
            return el;
        },

        addSearchButton() {
            const self = this;
            class SearchControl {
                onAdd(mp) {
                    this.map = mp;
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
                    this.container?.parentNode?.removeChild(this.container);
                    this.map = undefined;
                }
            }
            map.addControl(new SearchControl(), 'top-left');
        },

        debounceSearch() {
            if (this.searchTimeout) clearTimeout(this.searchTimeout);
            if (!this.searchQuery || this.searchQuery.length < 3) {
                this.localSearchResults = [];
                this.isSearching = false;
                return;
            }
            this.isSearching = true;
            this.searchTimeout = setTimeout(() => this.searchLocationFromModal(this.searchQuery), 500);
        },

        async searchLocationFromModal(query) {
            if (!query || query.length < 3) {
                this.isSearching = false;
                return;
            }
            try {
                const results = await maptilersdk.geocoding.forward(query);
                this.localSearchResults = results.features;
            } catch (e) {
                console.error('Search error:', e);
            } finally {
                this.isSearching = false;
            }
        },

        selectLocationFromModal(result) {
            const [lng, lat] = result.center || result.geometry.coordinates;
            map.setCenter([lng, lat]);
            map.setZoom(15);
            marker.setLngLat([lng, lat]);
            this.lat = lat;
            this.lng = lng;
            this.localSearchResults = [];
            this.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
        },

        setStyle(styleName) {
            const style = tileProviders[styleName] || maptilersdk.MapStyle.STREETS;
            map.setStyle(style);
        },

        addTileSelectorControl() {
            const self = this;
            class TileControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
                    const label = document.createElement('label');
                    label.textContent = self.config.map_type_text;
                    const select = document.createElement('select');
                    Object.keys(tileProviders).forEach((key) => {
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
                    this.container?.parentNode?.removeChild(this.container);
                    this.map = undefined;
                }
            }
            map.addControl(new TileControl(), 'top-right');
        },

        formatProviderName(name) {
            return name
                .replace(/\./g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (s) => s.toUpperCase())
                .trim();
        },

        addLocationButton() {
            const self = this;
            class LocationControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>`;
                    btn.title = self.config.myLocationButtonLabel || 'My Location';
                    btn.onclick = () => self.goToCurrentLocation();
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    this.container?.parentNode?.removeChild(this.container);
                    this.map = undefined;
                }
            }
            map.addControl(new LocationControl(), 'top-left');
        },

        goToCurrentLocation() {
            if (!navigator.geolocation) {
                new FilamentNotification()
                    .title('No Browser Support')
                    .body('Your browser does not support location services')
                    .danger()
                    .send();
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const latLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    this.setCoordinates(latLng);
                    marker.setLngLat([latLng.lng, latLng.lat]);
                    map.easeTo({ center: [latLng.lng, latLng.lat], zoom: 15 });
                    this.lat = latLng.lat;
                    this.lng = latLng.lng;
                },
                (err) => {
                    new FilamentNotification()
                        .title('Error')
                        .body('Could not get location. Please check console errors')
                        .danger()
                        .send();
                    console.error('Error getting location:', err);
                }
            );
        },

        markerMoved(event) {
            const position = event.latLng;
            this.lat = position.lat;
            this.lng = position.lng;
            this.setCoordinates({ lat: this.lat, lng: this.lng });
            marker.setLngLat([this.lng, this.lat]);
            map.easeTo({ center: [this.lng, this.lat] });
        },

        updateMapFromAlpine() {
            const location = this.getCoordinates();
            const pos = marker.getLngLat();
            if (location.lat !== pos.lat || location.lng !== pos.lng) {
                this.updateMap(location);
            }
        },

        updateMap(position) {
            marker.setLngLat([position.lng, position.lat]);
            map.easeTo({ center: [position.lng, position.lat] });
            this.lat = position.lat;
            this.lng = position.lng;
        },

        setCoordinates(position) {
            this.$wire.set(this.config.statePath, { lat: position.lat, lng: position.lng });
        },

        getCoordinates() {
            let location = this.$wire.get(this.config.statePath);
            if (!location || !location.lat || !location.lng) {
                location = { lat: this.config.defaultLocation.lat, lng: this.config.defaultLocation.lng };
            }
            return { lat: location.lat, lng: location.lng };
        },
    };
}
