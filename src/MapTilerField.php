<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
use Exception;
use Filament\Forms\Components\Concerns\CanBeReadOnly;
use Filament\Forms\Components\Field;
use JsonException;
use RuntimeException;

class MapTilerField extends Field
{
    use CanBeReadOnly;

    protected string $view = 'filament-map-tiler::filament-map-tiler-field';

    protected string | Closure $height = '400px';

    protected array | Closure | null $defaultLocation = [37.9106, 40.2365];

    protected int | Closure $defaultZoom = 13;

    protected bool | Closure $draggable = true;

    protected bool | Closure $clickable = true;

    protected string | Closure | null $myLocationButtonLabel = 'My Location';

    protected string | Closure | null $searchLocationButtonLabel = 'Search Location';

    protected string | Closure $tileProvider = 'STREETS';

    protected string | Closure $apiKey = '';

    protected array | Closure $customTiles = [];

    protected string | Closure $markerIconPath = '';

    protected string | Closure $markerShadowPath = '';

    protected bool $showTileControl = true;

    private int $precision = 8;

    protected ?array $customMarker = null;

    private array $mapConfig = [
        'draggable' => true,
        'clickable' => true,
        'defaultLocation' => [
            'lat' => 37.9106,
            'lng' => 40.2365,
        ],
        'statePath' => '',
        'defaultZoom' => 13,
        'myLocationButtonLabel' => '',
        'searchLocationButtonLabel' => '',
        'tileProvider' => 'STREETS',
        'customTiles' => [],
        'customMarker' => null,
        'markerIconPath' => '',
        'markerShadowPath' => '',
        'apiKey' => '',
        'showTaleControl' => false,
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
            $headers = @get_headers("https://api.maptiler.com/maps/streets/style.json?key={$apiKey}");
            if (! $headers || strpos($headers[0], '200') === false) {
                throw new RuntimeException('MapTiler API key is invalid or could not be verified.');
            }
        }

        $this->apiKey = $apiKey;
    }

    public function hideTileControl(): static
    {
        $this->showTileControl = false;

        return $this;
    }

    public function getTileControlVisibility(): bool
    {
        return $this->evaluate($this->showTileControl);
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

    public function defaultLocation(array | Closure $defaultLocation): static
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

        return [
            'lat' => 41.0082,
            'lng' => 28.9784,
        ];
    }

    public function defaultZoom(int | Closure $defaultZoom): static
    {
        $this->defaultZoom = $defaultZoom;

        return $this;
    }

    public function getDefaultZoom(): int
    {
        return $this->evaluate($this->defaultZoom);
    }

    public function draggable(bool | Closure $draggable = true): static
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

    public function clickable(bool | Closure $clickable = true): static
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

    public function height(string | Closure $height): static
    {
        $this->height = $height;

        return $this;
    }

    public function getHeight(): string
    {
        return (string)$this->evaluate($this->height);
    }

    public function myLocationButtonLabel(string | Closure $myLocationButtonLabel): static
    {
        $this->myLocationButtonLabel = $myLocationButtonLabel;

        return $this;
    }

    public function getMyLocationButtonLabel(): string
    {
        return (string)$this->evaluate($this->myLocationButtonLabel);
    }

    public function searchLocationButtonLabel(string | Closure $searchLocationButtonLabel): static
    {
        $this->searchLocationButtonLabel = $searchLocationButtonLabel;

        return $this;
    }

    public function getSearchLocationButtonLabel(): string
    {
        return (string)$this->evaluate($this->searchLocationButtonLabel);
    }

    public function tileProvider(string | Closure $tileProvider): static
    {
        $this->tileProvider = $tileProvider;

        return $this;
    }

    public function getTileProvider(): string
    {
        return (string)$this->evaluate($this->tileProvider);
    }

    public function customTiles(array | Closure $customTiles): static
    {
        $this->customTiles = $customTiles;

        return $this;
    }

    public function getCustomTiles(): array
    {
        return (array)$this->evaluate($this->customTiles);
    }

    public function markerIconPath(string | Closure $path): static
    {
        $this->markerIconPath = $path;

        return $this;
    }

    public function getMarkerIconPath(): string
    {
        return $this->evaluate($this->markerIconPath) ?: asset('vendor/filament-map-tiler/images/marker-icon-2x.png');
    }

    public function markerShadowPath(string | Closure $path): static
    {
        $this->markerShadowPath = $path;

        return $this;
    }

    public function getMarkerShadowPath(): string
    {
        return $this->evaluate($this->markerShadowPath) ?: asset('vendor/filament-map-tiler/images/marker-shadow.png');
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
            'myLocationButtonLabel' => $this->getMyLocationButtonLabel(),
            'searchLocationButtonLabel' => $this->getSearchLocationButtonLabel(),
            'tileProvider' => $this->getTileProvider(),
            'customTiles' => $this->getCustomTiles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'map_type_text' => __('filament-map-tiler::filament-map-tiler.map_type'),
            'is_disabled' => $this->isDisabled() || $this->isReadOnly(),
            'showTileControl' => $this->showTileControl,
            'apiKey' => $this->getApiKey(),
        ]);
    }

    public function apiKey(string | Closure $apiKey): static
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
