<?php

namespace GoodMaven\FilamentMapTiler;

use Filament\Infolists\Components\Entry;
use Filament\Support\Concerns\HasExtraAlpineAttributes;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;

class MapTilerEntry extends Entry
{
    use HasMapFeatures;
    use HasExtraAlpineAttributes;

    protected string $view = 'filament-map-tiler::filament-map-tiler-entry';

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureValidApiKey();
    }

    public function getMapConfig(): array
    {
        return [
            'apiKey' => $this->getApiKey(),
            'defaultZoomLevel' => $this->getDefaultZoomLevel(),
            'defaultLocation' => $this->getDefaultLocation(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'customMarker' => $this->getCustomMarker(),
            'customStyles' => $this->getCustomStyles(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            'maxBounds' => $this->getMaxBounds(),
            'language' => $this->getLanguage(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
        ];
    }
}
