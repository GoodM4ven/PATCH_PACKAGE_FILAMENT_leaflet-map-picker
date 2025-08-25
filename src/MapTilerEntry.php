<?php

namespace GoodMaven\FilamentMapTiler;

use Filament\Infolists\Components\Entry as Component;
use Filament\Support\Concerns\HasExtraAlpineAttributes;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

class MapTilerEntry extends Component
{
    use HasExtraAlpineAttributes;
    use HasMapFeatures;

    protected string $view = 'filament-map-tiler::filament-map-tiler-entry';

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureValidApiKey();
    }

    protected function ensureValidApiKey(): void
    {
        $apiKey = $this->evaluate($this->apiKey) ?: $this->getMapTilerConfig('api_key');

        if (empty($apiKey)) {
            throw new RuntimeException('MapTiler API key is missing.');
        }

        if (! app()->environment('testing')) {
            $cacheKey = 'filament-map-tiler-api-key-'.md5($apiKey);
            if (! Cache::get($cacheKey)) {
                $headers = @get_headers("https://api.maptiler.com/maps/streets/style.json?key={$apiKey}");
                if (! $headers || strpos($headers[0], '200') === false) {
                    throw new RuntimeException('MapTiler API key is invalid or could not be verified.');
                }
                Cache::forever($cacheKey, true);
            }
        }

        $this->apiKey = $apiKey;
    }

    public function getMapConfig(): array
    {
        return [
            'defaultZoom' => $this->getDefaultZoom(),
            'defaultLocation' => $this->getDefaultLocation(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'customMarker' => $this->getCustomMarker(),
            'customTiles' => $this->getCustomTiles(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'apiKey' => $this->getApiKey(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            'maxBounds' => $this->getMaxBounds(),
            'language' => $this->getLanguage(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
        ];
    }
}
