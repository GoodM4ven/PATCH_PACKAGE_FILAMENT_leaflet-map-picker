import * as maptilersdk from '@maptiler/sdk';

export default function mapTilerPicker({ config }) {
    let map = null;
    let marker = null;
    let styles = null;
    const locales = {
        ar: {
            'NavigationControl.ZoomIn': 'تكبير',
            'NavigationControl.ZoomOut': 'تصغير',
            'NavigationControl.ResetBearing': 'إعادة الاتجاه إلى الشمال',
            'NavigationControl.RotateLeft': 'استدارة لليسار',
            'NavigationControl.RotateRight': 'استدارة لليمين',
            'NavigationControl.PitchUp': 'رفع الميل',
            'NavigationControl.PitchDown': 'خفض الميل',
        },
    };

    const S = () => Alpine.store('mt');

    return {
        lat: null,
        lng: null,
        config: {
            draggable: true,
            clickable: true,
            defaultZoom: 13,
            defaultLocation: { lat: 41.0082, lng: 28.9784 }, // ???
            searchLocationButtonLabel: '',
            statePath: '',
            style: 'STREETS',
            customTiles: [],
            customMarker: null,
            is_disabled: false,
            showStyleSwitcher: false,
            apiKey: '',
            style_text: 'Map Style',
            disableRotation: false,
            hash: false,
            maxBounds: null,
            language: null,
            geolocate: false,
            zoomable: true,
        },

        init() {
            // ensure global store for teleported modal
            if (!Alpine.store('mt')) {
                Alpine.store('mt', {
                    searchQuery: '',
                    localSearchResults: [],
                    isSearching: false,
                    searchTimeout: null,
                });
            }

            this.config = { ...this.config, ...config };
            if (!this.config.apiKey) throw new Error('MapTiler API key is required');
            maptilersdk.config.apiKey = this.config.apiKey;
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                maptilersdk.config.primaryLanguage = lang;
            }

            styles = {
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
            if (this.config.customTiles && Object.keys(this.config.customTiles).length > 0) {
                styles = { ...styles, ...this.config.customTiles };
            }

            this.initMap();
        },

        initMap() {
            const initial = { ...this.getCoordinates() };
            const center = [initial.lng, initial.lat];

            const mapOptions = {
                container: this.$refs.mapContainer,
                style: styles[this.config.style] || maptilersdk.MapStyle.STREETS,
                center,
                zoom: this.config.defaultZoom,
            };
            if (this.config.hash) mapOptions.hash = true;
            if (this.config.maxBounds) mapOptions.maxBounds = this.config.maxBounds;

            map = new maptilersdk.Map(mapOptions);

            if (this.config.geolocate) {
                const geo = new maptilersdk.GeolocateControl();
                map.addControl(geo);
                geo.trigger();
            }

            if (!this.config.disableRotation) {
                map.addControl(
                    new maptilersdk.MaptilerNavigationControl({
                        showCompass: true,
                        showZoom: this.config.zoomable,
                        visualizePitch: true,
                    }),
                    'top-right'
                );
            } else {
                map.dragRotate.disable();
                map.touchZoomRotate.disableRotation();
            }

            if (!this.config.zoomable) {
                map.scrollZoom.disable();
                map.boxZoom.disable();
                map.doubleClickZoom.disable();
                map.touchZoomRotate.disable();
                map.keyboard.disable();
            }

            // avoid empty sprite warning noise (harmless, but noisy)
            map.on('styleimagemissing', (e) => {
                if (!e.id || !e.id.trim()) return;
            });

            const opts = { draggable: this.config.draggable };
            if (this.config.customMarker) opts.element = this.createMarkerElement(this.config.customMarker);
            marker = new maptilersdk.Marker(opts).setLngLat(center).addTo(map);

            this.lat = initial.lat;
            this.lng = initial.lng;
            this.setCoordinates(initial);

            if (this.config.clickable) map.on('click', (e) => this.markerMoved({ latLng: e.lngLat }));
            if (this.config.draggable) marker.on('dragend', () => this.markerMoved({ latLng: marker.getLngLat() }));

            if (!this.config.is_disabled) {
                this.addSearchButton();
            }
            if (this.config.showStyleSwitcher) this.addStyleSwitcherControl();
            if (this.config.language) {
                const lang = maptilersdk.Language[this.config.language] || this.config.language;
                map.on('load', () => {
                    map.setLanguage(lang);
                    if (locales[this.config.language]) {
                        map.setLocale(locales[this.config.language]);
                    }
                });
            } else if (locales[this.config.language]) {
                map.setLocale(locales[this.config.language]);
            }
        },

        // --- search helpers now use the store
        debounceSearch() {
            const st = S();
            if (st.searchTimeout) clearTimeout(st.searchTimeout);
            if (!st.searchQuery || st.searchQuery.length < 3) {
                st.localSearchResults = [];
                st.isSearching = false;
                return;
            }
            st.isSearching = true;
            st.searchTimeout = setTimeout(() => this.searchLocationFromModal(st.searchQuery), 500);
        },

        async searchLocationFromModal(query) {
            const st = S();
            if (!query || query.length < 3) {
                st.isSearching = false;
                return;
            }
            try {
                const results = await maptilersdk.geocoding.forward(query);
                st.localSearchResults = results.features;
            } catch (e) {
                console.error('Search error:', e);
            } finally {
                st.isSearching = false;
            }
        },

        selectLocationFromModal(result) {
            const [lng, lat] = result.center || result.geometry.coordinates;
            map.setCenter([lng, lat]);
            map.setZoom(15);
            marker.setLngLat([lng, lat]);
            this.lat = lat;
            this.lng = lng;

            const st = S();
            st.localSearchResults = [];
            st.searchQuery = '';
            this.$dispatch('close-modal', { id: 'location-search-modal' });
        },

        setStyle(styleName) {
            const style = styles[styleName] || maptilersdk.MapStyle.STREETS;
            map.setStyle(style);
        },

        addSearchButton() {
            const self = this;
            class SearchControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
                    const btn = document.createElement('button');
                    btn.className = 'items-center';
                    btn.style.display = 'grid';
                    btn.style.justifyContent = 'center';
                    btn.type = 'button';
                    btn.innerHTML = [
                        '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">',
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/>',
                        '</svg>',
                    ].join('');
                    btn.title = self.config.searchLocationButtonLabel || 'Search Location';
                    btn.onclick = () => {
                        self.$dispatch('open-modal', { id: 'location-search-modal' });
                    };
                    this.container.appendChild(btn);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) {
                        this.container.parentNode.removeChild(this.container);
                    }
                    this.map = undefined;
                }
            }
            map.addControl(new SearchControl(), 'top-left');
        },

        addStyleSwitcherControl() {
            const self = this;
            class TileControl {
                onAdd(mp) {
                    this.map = mp;
                    this.container = document.createElement('div');
                    this.container.className = 'map-tiler-tile-selector maplibregl-ctrl maplibregl-ctrl-group';
                    const label = document.createElement('label');
                    label.textContent = self.config.style_text;
                    const select = document.createElement('select');
                    Object.keys(styles).forEach((key) => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = self.formatStyleName(key);
                        if (key === self.config.style) option.selected = true;
                        select.appendChild(option);
                    });
                    select.onchange = (e) => self.setStyle(e.target.value);
                    this.container.appendChild(label);
                    this.container.appendChild(select);
                    return this.container;
                }
                onRemove() {
                    if (this.container && this.container.parentNode) {
                        this.container.parentNode.removeChild(this.container);
                    }
                    this.map = undefined;
                }
            }
            map.addControl(new TileControl(), 'top-right');
        },

        formatStyleName(name) {
            return name
                .replace(/\./g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, (s) => s.toUpperCase())
                .trim();
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
