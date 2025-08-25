<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
use Exception;
use Filament\Forms\Components\Concerns\CanBeReadOnly;
use Filament\Forms\Components\Field;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;
use Illuminate\Support\Facades\Cache;
use JsonException;
use RuntimeException;

class MapTilerField extends Field
{
    use CanBeReadOnly;
    use HasMapFeatures;

    protected string $view = 'filament-map-tiler::map-tiler-field';

    protected string|Closure|null $searchLocationButtonLabel = 'Search Location';

    protected bool|array|Closure $geolocate = false;

    private int $precision = 8;

    private array $mapConfig = [
        'draggable' => true,
        'clickable' => true,
        'statePath' => '',
        'searchLocationButtonLabel' => '',
        'style' => 'STREETS',
        'customTiles' => [],
        'customMarker' => null,
        'markerIconPath' => '',
        'markerShadowPath' => '',
        'apiKey' => '',
        'showStyleSwitcher' => false,
        'rotationable' => true,
        'hash' => false,
        'maxBounds' => null,
        'language' => null,
        'zoomable' => true,
        'controlTranslations' => [],
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->afterStateHydrated(fn() => $this->ensureValidApiKey());
    }

    protected function ensureValidApiKey(): void
    {
        $apiKey = $this->evaluate($this->apiKey) ?: config('filament-map-tiler.api_key');

        if (empty($apiKey)) {
            throw new RuntimeException('MapTiler API key is missing.');
        }

        if (! app()->environment('testing')) {
            $cacheKey = 'filament-map-tiler-api-key-' . md5($apiKey);
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

    public function showStyleSwitcher(): static
    {
        $this->showStyleSwitcher = true;

        return $this;
    }

    public function getStyleSwitcherVisibility(): bool
    {
        return $this->evaluate($this->showStyleSwitcher);
    }

    public function customMarker(array $config): static
    {
        $this->customMarker = $config;

        return $this;
    }

    public function getCustomMarker(): ?array
    {
        return $this->customMarker;
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
            } elseif (is_numeric($position[0]) && is_numeric($position[1])) {
                return [
                    'lat' => is_string($position[0]) ? round(floatval($position[0]), $this->precision) : $position[0],
                    'lng' => is_string($position[1]) ? round(floatval($position[1]), $this->precision) : $position[1],
                ];
            }
        }

        $default = config('filament-map-tiler.default_location', [
            'lat' => 34.890832,
            'lng' => 38.542143,
        ]);

        return $default;
    }

    /**
     * Enable geolocation and optionally control behavior.
     *
     * Examples:
     * ->geolocate()                                // enabled, runOnLoad=false, pinAsWell=true
     * ->geolocate(runOnLoad: true)                 // enabled, trigger on load
     * ->geolocate(pinAsWell: false)                // enabled, don't move pin
     * ->geolocate(false)                           // disabled
     * ->geolocate(['runOnLoad' => true])           // array form
     */
    public function geolocate(
        bool|array $enabledOrSettings = true,
        ?bool $runOnLoad = null,
        ?bool $pinAsWell = null,
        ?int $cacheInMs = 5 * 60 * 1000,
    ): static
    {
        if (is_bool($enabledOrSettings)) {
            $settings = ['enabled' => $enabledOrSettings];
        } else {
            $settings = array_merge(['enabled' => true], $enabledOrSettings);
        }

        if ($runOnLoad !== null) {
            $settings['runOnLoad'] = $runOnLoad;
        }
        if ($pinAsWell !== null) {
            $settings['pinAsWell'] = $pinAsWell;
        }
        if ($cacheInMs !== null) {
            $settings['cacheInMs'] = $cacheInMs;
        }

        $this->geolocate = $settings;

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

    public function defaultZoom(int|Closure $defaultZoom): static
    {
        $this->defaultZoom = $defaultZoom;

        return $this;
    }

    public function getDefaultZoom(): int
    {
        return $this->evaluate($this->defaultZoom)
            ?? (int) config('filament-map-tiler.default_zoom_level', 13);
    }

    public function draggable(bool|Closure $draggable = true): static
    {
        $this->draggable = $draggable;

        return $this;
    }

    public function getDraggable(): bool
    {
        if ($this->isDisabled || $this->isReadOnly) {
            return false;
        }

        return $this->evaluate($this->draggable);
    }

    public function clickable(bool|Closure $clickable = true): static
    {
        $this->clickable = $clickable;

        return $this;
    }

    public function getClickable(): bool
    {
        if ($this->isDisabled || $this->isReadOnly) {
            return false;
        }

        return $this->evaluate($this->clickable);
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

    public function searchLocationButtonLabel(string|Closure $searchLocationButtonLabel): static
    {
        $this->searchLocationButtonLabel = $searchLocationButtonLabel;

        return $this;
    }

    public function getSearchLocationButtonLabel(): string
    {
        return (string) $this->evaluate($this->searchLocationButtonLabel);
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

    public function customTiles(array|Closure $customTiles): static
    {
        $this->customTiles = $customTiles;

        return $this;
    }

    public function getCustomTiles(): array
    {
        return (array) $this->evaluate($this->customTiles);
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

    public function zoomable(bool|Closure $zoomable = true): static
    {
        $this->zoomable = $zoomable;

        return $this;
    }

    public function getZoomable(): bool
    {
        return (bool) $this->evaluate($this->zoomable);
    }

    public function rateLimit(array|Closure $limits): static
    {
        $this->rateLimit = $limits;

        return $this;
    }

    public function getRateLimit(): array
    {
        $defaults = config('filament-map-tiler.rate_limit_values', [
            'interval' => 60_000,
            'geolocate' => 5,
            'zoom' => 360,
            'pinMove' => 60,
            'cameraMove' => 80,
            'search' => 10,
        ]);

        return array_merge($defaults, (array) $this->evaluate($this->rateLimit));
    }

    public function onRateLimit(Closure $callback): static
    {
        $this->onRateLimit = $callback;

        return $this;
    }

    public function getListeners(?string $event = null): array
    {
        return array_merge(parent::getListeners($event), [
            $this->getRateLimitEvent() => 'handleRateLimit',
        ]);
    }

    public function handleRateLimit(array $data): void
    {
        if (($data['statePath'] ?? null) !== $this->getStatePath()) {
            return;
        }

        if ($this->onRateLimit) {
            $this->evaluate($this->onRateLimit, $data);
        }
    }

    public function getRateLimitEvent(): string
    {
        return 'map-tiler-rate-limit';
    }

    /**
     * @throws JsonException
     */
    public function getMapConfig(): array
    {
        return array_merge($this->mapConfig, [
            'draggable' => $this->getDraggable(),
            'clickable' => $this->getClickable(),
            'defaultLocation' => $this->getDefaultLocation(),
            'statePath' => $this->getStatePath(),
            'defaultZoom' => $this->getDefaultZoom(),
            'searchLocationButtonLabel' => $this->getSearchLocationButtonLabel(),
            'style' => $this->getStyle(),
            'customTiles' => $this->getCustomTiles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'style_text' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'is_disabled' => $this->isDisabled() || $this->isReadOnly(),
            'showStyleSwitcher' => $this->showStyleSwitcher,
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            'maxBounds' => $this->getMaxBounds(),
            'language' => $this->getLanguage(),
            'geolocate' => $this->getGeolocate(),
            'zoomable' => $this->getZoomable(),
            'apiKey' => $this->getApiKey(),
            'rateLimit' => $this->getRateLimit(),
            'rateLimitEvent' => $this->getRateLimitEvent(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
        ]);
    }

    public function apiKey(string|Closure $apiKey): static
    {
        $this->apiKey = $apiKey;

        return $this;
    }

    public function getApiKey(): string
    {
        return (string) $this->apiKey;
    }

    /**
     * @throws JsonException
     */
    public function getState(): array
    {
        $state = parent::getState();

        if (is_array($state)) {
            return $state;
        } else {
            try {
                return @json_decode($state, true, 512, JSON_THROW_ON_ERROR);
            } catch (Exception $e) {
                return $this->getDefaultLocation();
            }
        }
    }
}
