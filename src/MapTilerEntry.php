<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
use Filament\Infolists\Components\Entry as Component;
use Filament\Support\Concerns\HasExtraAlpineAttributes;
use Illuminate\Support\Facades\Cache;
use RuntimeException;

class MapTilerEntry extends Component
{
    use HasExtraAlpineAttributes;

    protected string $view = 'filament-map-tiler::filament-map-tiler-entry';

    protected string|Closure $height = '400px';

    protected int $defaultZoom = 13;

    protected array $defaultLocation = [
        'lat' => 41.0082,
        'lng' => 28.9784,
    ];

    protected string $style = 'STREETS';

    protected string $apiKey = '';

    protected bool $showTileSwitcher = true;

    protected ?array $customMarker = null;

    protected array $customTiles = [];

    protected string|Closure $markerIconPath = '';

    protected string|Closure $markerShadowPath = '';

    protected bool|Closure $disableRotation = false;

    protected bool|Closure $hash = false;

    protected array|Closure|null $maxBounds = null;

    protected string|Closure|null $language = null;

    protected bool|Closure $geolocate = false;

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

    public function style(string $style): static
    {
        $this->style = $style;

        return $this;
    }

    public function hideTileSwitcher(): static
    {
        $this->showTileSwitcher = false;

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
        return $this->defaultZoom;
    }

    public function getDefaultLocation(): array
    {
        return $this->defaultLocation;
    }

    public function getStyle(): string
    {
        return $this->style;
    }

    public function getShowTileSwitcher(): bool
    {
        return $this->showTileSwitcher;
    }

    public function getCustomMarker(): ?array
    {
        return $this->customMarker;
    }

    public function getCustomTiles(): array
    {
        return $this->customTiles;
    }

    public function disableRotation(bool|Closure $disable = true): static
    {
        $this->disableRotation = $disable;

        return $this;
    }

    public function getDisableRotation(): bool
    {
        return (bool) $this->evaluate($this->disableRotation);
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
        return $this->evaluate($this->language);
    }

    public function geolocate(bool|Closure $geolocate = true): static
    {
        $this->geolocate = $geolocate;

        return $this;
    }

    public function getGeolocate(): bool
    {
        return (bool) $this->evaluate($this->geolocate);
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
}
