<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
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

    private array $mapConfig = [
        'apiKey' => '',
        'language' => null,
        'draggable' => true,
        'clickable' => true,
        'searchLocationButtonLabel' => '',
        'style' => 'STREETS',
        'customTiles' => [],
        'customMarker' => null,
        'markerIconPath' => '',
        'markerShadowPath' => '',
        'showStyleSwitcher' => false,
        'rotationable' => true,
        'hash' => false,
        'maxBounds' => null,
        'zoomable' => true,
        'controlTranslations' => [],
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->ensureValidApiKey();
    }

    protected function ensureValidApiKey(): void
    {
        $apiKey = $this->apiKey ?: config('filament-map-tiler.api_key');

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

    public function defaultZoom(int $defaultZoom): static
    {
        $this->defaultZoom = $defaultZoom;

        return $this;
    }

    public function defaultLocation(array $defaultLocation): static
    {
        $this->defaultLocation = $defaultLocation;

        return $this;
    }

    public function geolocate(bool|array|Closure $geolocate = true): static
    {
        $this->geolocate = $geolocate;

        return $this;
    }

    public function getGeolocate(): array
    {
        $value = $this->evaluate($this->geolocate);
        $defaults = config('filament-map-tiler.geolocate_options', [
            'enabled' => false,
            'runOnLoad' => false,
            'pinAsWell' => true,
            'cacheInMs' => 5 * 60 * 1000,
        ]);

        if ($value === false) {
            return array_merge($defaults, ['enabled' => false]);
        }

        if ($value === true) {
            return array_merge($defaults, ['enabled' => true]);
        }

        return array_merge($defaults, (array) $value);
    }

    public function style(string $style): static
    {
        $this->style = $style;

        return $this;
    }

    public function showStyleSwitcher(): static
    {
        $this->showStyleSwitcher = true;

        return $this;
    }

    public function customMarker(?array $customMarker): static
    {
        $this->customMarker = $customMarker;

        return $this;
    }

    public function customTiles(array $customTiles): static
    {
        $this->customTiles = $customTiles;

        return $this;
    }

    public function getDefaultZoom(): int
    {
        return $this->evaluate($this->defaultZoom)
            ?? (int) config('filament-map-tiler.default_zoom_level', 13);
    }

    public function getDefaultLocation(): array
    {
        $position = $this->evaluate($this->defaultLocation);
        if (is_array($position) && isset($position['lat'], $position['lng'])) {
            return $position;
        }

        return config('filament-map-tiler.default_location', [
            'lat' => 34.890832,
            'lng' => 38.542143,
        ]);
    }

    public function getStyle(): string
    {
        return $this->style;
    }

    public function getShowStyleSwitcher(): bool
    {
        return $this->showStyleSwitcher;
    }

    public function getCustomMarker(): ?array
    {
        return $this->customMarker;
    }

    public function getCustomTiles(): array
    {
        return $this->customTiles;
    }

    public function hash(bool|Closure $hash = true): static
    {
        $this->hash = $hash;

        return $this;
    }

    public function getHash(): bool
    {
        return (bool) $this->evaluate($this->hash);
    }

    public function maxBounds(array|Closure|null $bounds): static
    {
        $this->maxBounds = $bounds;

        return $this;
    }

    public function getMaxBounds(): ?array
    {
        return $this->evaluate($this->maxBounds);
    }

    public function language(string|Closure $language): static
    {
        $this->language = $language;

        return $this;
    }

    public function getLanguage(): ?string
    {
        $lang = $this->evaluate($this->language);
        if (! is_string($lang)) {
            return null;
        }
        $lang = strtolower($lang);
        if (in_array($lang, ['ar', 'arabic'])) {
            return 'ar';
        }

        return $lang;
    }

    public function markerIconPath(string|Closure $path): static
    {
        $this->markerIconPath = $path;

        return $this;
    }

    public function getMarkerIconPath(): string
    {
        return $this->evaluate($this->markerIconPath) ?: asset('vendor/filament-map-tiler/images/marker-icon-2x.png');
    }

    public function markerShadowPath(string|Closure $path): static
    {
        $this->markerShadowPath = $path;

        return $this;
    }

    public function getMarkerShadowPath(): string
    {
        return $this->evaluate($this->markerShadowPath) ?: asset('vendor/filament-map-tiler/images/marker-shadow.png');
    }

    public function apiKey(string $apiKey): static
    {
        $this->apiKey = $apiKey;

        return $this;
    }

    public function getApiKey(): string
    {
        return $this->apiKey;
    }

    public function height(string|Closure $height): static
    {
        $this->height = $height;

        return $this;
    }

    public function getHeight(): string
    {
        return (string) $this->evaluate($this->height);
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
            'geolocate' => $this->getGeolocate(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
        ];
    }
}
