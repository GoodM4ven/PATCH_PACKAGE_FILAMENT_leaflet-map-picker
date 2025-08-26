<?php

namespace GoodMaven\FilamentMapTiler;

use Closure;
use Exception;
use Filament\Forms\Components\Field;
use GoodMaven\FilamentMapTiler\Concerns\HasMapFeatures;
use JsonException;

class MapTilerField extends Field
{
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

        $this->afterStateHydrated(fn() => $this->ensureValidApiKey());
    }

    public function getMapConfig(): array
    {
        return [
            'apiKey' => $this->getApiKey(),
            'language' => $this->getLanguage(),
            'controlTranslations' => __('filament-map-tiler::filament-map-tiler.controls'),
            'defaultLocation' => $this->getDefaultLocation(),
            'minZoomLevel' => $this->getMinZoomLevel(),
            'defaultZoom' => $this->getDefaultZoomLevel(),
            'maxZoomLevel' => $this->getMaxZoomLevel(),
            'zoomable' => $this->getZoomable(),
            'geolocate' => $this->getGeolocate(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'style_switcher_label' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'customStyles' => $this->getCustomStyles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'maxBounds' => $this->getMaxBounds(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            'statePath' => $this->getStatePath(),
            'is_disabled' => $this->isDisabled(),
            'draggable' => $this->getDraggable(),
            'clickable' => $this->getClickable(),
            'searchLocationButtonLabel' => $this->getSearchLocationButtonLabel(),
            'rateLimit' => $this->getRateLimit(),
            'rateLimitEvent' => $this->getRateLimitEvent(),
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
        } else {
            try {
                return @json_decode($state, true, 512, JSON_THROW_ON_ERROR);
            } catch (Exception $e) {
                return $this->getDefaultLocation();
            }
        }
    }

    public function draggable(bool|Closure $draggable = true): static
    {
        $this->draggable = $draggable;

        return $this;
    }

    public function getDraggable(): bool
    {
        return $this->isDisabled ? false : $this->evaluate($this->draggable);
    }

    public function clickable(bool|Closure $clickable = true): static
    {
        $this->clickable = $clickable;

        return $this;
    }

    public function getClickable(): bool
    {
        return $this->isDisabled ? false : $this->evaluate($this->clickable);
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
        $defaults = $this->getMapTilerConfig('defaults.rate_limit_values');

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
}
