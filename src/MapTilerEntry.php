<?php

namespace GoodMaven\FilamentMapTiler;

use Filament\Infolists\Components\Entry;
use Filament\Support\Concerns\HasExtraAlpineAttributes;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;

class MapTilerEntry extends Entry
{
    use HasExtraAlpineAttributes;
    use HasMapFeatures;

    protected string $view = 'filament-map-tiler::map-tiler-entry';

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureValidApiKey();
    }

    public function getMapConfig(): array
    {
        return [
            'apiKey' => $this->getApiKey(),
            'language' => $this->getLanguage(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
            'defaultLocation' => $this->getDefaultLocation(),
            'minZoomLevel' => $this->getMinZoomLevel(),
            'defaultZoom' => $this->getDefaultZoomLevel(),
            'maxZoomLevel' => $this->getMaxZoomLevel(),
            'zoomable' => $this->getZoomable(),
            'geolocate' => $this->getGeolocate(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'style_switcher_label' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'customStyles' => $this->getCustomStyles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'maxBounds' => $this->getMaxBounds(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            'rateLimit' => $this->getMapTilerConfig('defaults.rate_limit_values'),
        ];
    }
}
