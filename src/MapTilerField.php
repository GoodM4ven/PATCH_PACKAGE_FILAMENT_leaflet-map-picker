<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
use Exception;
use Filament\Forms\Components\Concerns\CanBeReadOnly;
use Filament\Forms\Components\Field;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;
use JsonException;

class MapTilerField extends Field
{
    use CanBeReadOnly;
    use HasMapFeatures;

    protected string $view = 'filament-map-tiler::map-tiler-field';

    protected bool|Closure $draggable = true;

    protected bool|Closure $clickable = true;

    protected string|Closure|null $searchLocationButtonLabel = 'Search Location';

    protected array|Closure $rateLimit = [];

    protected ?Closure $onRateLimit = null;

    protected function setUp(): void
    {
        parent::setUp();

        $this->afterStateHydrated(fn () => $this->ensureValidApiKey());
    }

    public function getStyleSwitcherVisibility(): bool
    {
        return $this->getShowStyleSwitcher();
    }

    public function defaultZoom(int|Closure $defaultZoom): static
    {
        return $this->defaultZoomLevel($defaultZoom);
    }

    public function getDefaultZoom(): int
    {
        return $this->getDefaultZoomLevel();
    }

    public function customTiles(array|Closure $customTiles): static
    {
        return $this->customStyles($customTiles);
    }

    public function getCustomTiles(): array
    {
        return $this->getCustomStyles();
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

        return (bool) $this->evaluate($this->draggable);
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

        return (bool) $this->evaluate($this->clickable);
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

    public function rateLimit(array|Closure $limits): static
    {
        $this->rateLimit = $limits;

        return $this;
    }

    public function getRateLimit(): array
    {
        $defaults = config('filament-map-tiler.rate_limit', [
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
        return [
            'draggable' => $this->getDraggable(),
            'clickable' => $this->getClickable(),
            'defaultLocation' => $this->getDefaultLocation(),
            'statePath' => $this->getStatePath(),
            'defaultZoom' => $this->getDefaultZoomLevel(),
            'searchLocationButtonLabel' => $this->getSearchLocationButtonLabel(),
            'style' => $this->getStyle(),
            'customStyles' => $this->getCustomStyles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'style_text' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'is_disabled' => $this->isDisabled() || $this->isReadOnly(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
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
        ];
    }

    /**
     * @throws JsonException
     */
    public function getState(): array
    {
        $state = parent::getState();

        if (is_array($state)) {
            return $state;
        }

        try {
            return @json_decode($state, true, 512, JSON_THROW_ON_ERROR);
        } catch (Exception $e) {
            return $this->getDefaultLocation();
        }
    }
}

