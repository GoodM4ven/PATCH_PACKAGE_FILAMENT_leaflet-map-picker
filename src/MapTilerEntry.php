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

    public function getListeners(?string $event = null): array
    {
        return array_merge(parent::getListeners($event), [
            $this->getRateLimitEvent() => 'handleRateLimit',
        ]);
    }

    public function getMapConfig(): array
    {
        return [
            'apiKey' => $this->getApiKey(),
            'language' => $this->getLanguage(),
            'controlTranslations' => $this->getControlTranslations(),
            'defaultLocation' => $this->getDefaultLocation(),
            'minZoomLevel' => $this->getMinZoomLevel(),
            'initialZoomLevel' => $this->getInitialZoomLevel(),
            'maxZoomLevel' => $this->getMaxZoomLevel(),
            'rateLimits' => $this->getRateLimits(),
            'rateLimitEvent' => $this->getRateLimitEvent(),
            'zoomable' => $this->getZoomable(),
            'geolocate' => $this->getGeolocate(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'styleSwitcherLabel' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'customStyles' => $this->getCustomStyles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'maxBounds' => $this->getMaxBounds(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
        ];
    }
}
