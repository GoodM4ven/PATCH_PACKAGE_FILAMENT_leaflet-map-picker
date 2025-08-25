<?php

namespace GoodMaven\FilamentMapTiler\Concerns;

use Closure;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

trait HasMapFeatures
{
    protected string|Closure $apiKey = '';

    protected string|Closure $height = '400px';

    protected string|Closure|null $language = null;

    protected array|Closure|null $defaultLocation = null;

    protected int|Closure|null $minZoomLevel = null;

    protected int|Closure|null $initialZoomLevel = null;
    
    protected int|Closure|null $maxZoomLevel = null;

    protected bool|Closure $zoomable = true;

    protected string $style = 'STREETS';

    protected bool $showStyleSwitcher = false;

    protected array $customStyles = [];

    protected ?array $customMarker = null;

    protected string|Closure $markerIconPath = '';

    protected string|Closure $markerShadowPath = '';

    protected array|Closure|null $maxBounds = null;

    protected bool|Closure $rotationable = true;

    protected bool|Closure $hash = false;

    protected function getMapTilerConfig(string $key): mixed
    {
        $value = config("filament-map-tiler.$key");

        if ($value === null) {
            throw new RuntimeException("Missing config value: filament-map-tiler.$key");
        }

        return $value;
    }

    public function apiKey(string|Closure $apiKey): static
    {
        $this->apiKey = $apiKey;

        return $this;
    }

    public function getApiKey(): string
    {
        return (string) $this->evaluate($this->apiKey);
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

    public function height(string|Closure $height): static
    {
        $this->height = $height;

        return $this;
    }

    public function getHeight(): string
    {
        return (string) $this->evaluate($this->height);
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

    public function defaultLocation(array|Closure $defaultLocation): static
    {
        $this->defaultLocation = $defaultLocation;

        return $this;
    }

    public function getDefaultLocation(): array
    {
        $position = $this->evaluate($this->defaultLocation);

        if (is_array($position)) {
            if (array_key_exists('lat', $position) && array_key_exists('lng', $position)) {
                return $position;
            }

            if (isset($position[0], $position[1]) && is_numeric($position[0]) && is_numeric($position[1])) {
                return [
                    'lat' => $position[0],
                    'lng' => $position[1],
                ];
            }
        }

        return $this->getMapTilerConfig('default_location');
    }

    public function minZoomLevel(null|int|Closure $minZoomLevel): static
    {
        $this->minZoomLevel = $minZoomLevel;

        return $this;
    }

    public function getMinZoomLevel(): ?int
    {
        return ($this->evaluate($this->minZoomLevel) ?? $this->getMapTilerConfig('defaults.zoom_level.min')) ?? null;
    }
    
    public function initialZoomLevel(int|Closure $initialZoomLevel): static
    {
        $this->initialZoomLevel = $initialZoomLevel;

        return $this;
    }

    public function getInitialZoomLevel(): int
    {
        return (int) ($this->evaluate($this->initialZoomLevel) ?? $this->getMapTilerConfig('defaults.zoom_level.initial'));
    }
    
    public function maxZoomLevel(int|Closure $maxZoomLevel): static
    {
        $this->maxZoomLevel = $maxZoomLevel;

        return $this;
    }

    public function getMaxZoomLevel(): int
    {
        return (int) ($this->evaluate($this->maxZoomLevel) ?? $this->getMapTilerConfig('defaults.zoom_level.max'));
    }

    public function zoomable(bool|Closure $zoomable = true): static
    {
        $this->zoomable = $zoomable;

        return $this;
    }

    public function getZoomable(): bool
    {
        return (bool) $this->evaluate($this->zoomable);
    }

    public function style(string|Closure $style): static
    {
        $this->style = $style;

        return $this;
    }

    public function getStyle(): string
    {
        return (string) $this->evaluate($this->style);
    }

    public function showStyleSwitcher(): static
    {
        $this->showStyleSwitcher = true;

        return $this;
    }

    public function getShowStyleSwitcher(): bool
    {
        return $this->showStyleSwitcher;
    }

    public function customStyles(array|Closure $customStyles): static
    {
        $this->customStyles = $customStyles;

        return $this;
    }

    public function getCustomStyles(): array
    {
        return (array) $this->evaluate($this->customStyles);
    }

    public function customMarker(?array $customMarker): static
    {
        $this->customMarker = $customMarker;

        return $this;
    }

    public function getCustomMarker(): ?array
    {
        return $this->customMarker;
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

    public function maxBounds(array|Closure|null $bounds): static
    {
        $this->maxBounds = $bounds;

        return $this;
    }

    public function getMaxBounds(): ?array
    {
        return $this->evaluate($this->maxBounds);
    }

    public function rotationable(bool|Closure $rotationable = true): static
    {
        $this->rotationable = $rotationable;

        return $this;
    }

    public function getRotationable(): bool
    {
        return (bool) $this->evaluate($this->rotationable);
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
}
