<?php

namespace GoodMaven\FilamentMapTiler\Concerns;

use Closure;
use RuntimeException;

trait HasMapFeatures
{
    protected string|Closure $apiKey = '';

    protected string|Closure $height = '400px';

    protected string|Closure|null $language = null;

    protected array|Closure|null $defaultLocation = null;

    protected int|Closure|null $defaultZoom = null;

    protected string $style = 'STREETS';

    protected bool $showStyleSwitcher = false;

    protected array $customTiles = [];

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

    public function defaultZoom(int|Closure $defaultZoom): static
    {
        $this->defaultZoom = $defaultZoom;

        return $this;
    }

    public function getDefaultZoom(): int
    {
        return (int) ($this->evaluate($this->defaultZoom) ?? $this->getMapTilerConfig('default_zoom_level'));
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

    public function customTiles(array|Closure $customTiles): static
    {
        $this->customTiles = $customTiles;

        return $this;
    }

    public function getCustomTiles(): array
    {
        return (array) $this->evaluate($this->customTiles);
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
