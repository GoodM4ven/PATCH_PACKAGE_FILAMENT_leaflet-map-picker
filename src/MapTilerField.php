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

    protected function setUp(): void
    {
        parent::setUp();

        $this->afterStateHydrated(fn() => $this->ensureValidApiKey());
    }

    public function getListeners(?string $event = null): array
    {
        return array_merge(parent::getListeners($event), [
            $this->getRateLimitEvent() => 'handleRateLimit',
        ]);
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
        } catch (Exception) {
            return $this->getDefaultLocation();
        }
    }

    public function getStyleSwitcherVisibility(): bool
    {
        return $this->getShowStyleSwitcher();
    }

    public function draggable(bool|Closure $draggable = true): static
    {
        $this->draggable = $draggable;

        return $this;
    }

    public function getDraggable(): bool
    {
        return (bool) $this->isDisabled ? false : $this->evaluate($this->draggable);
    }

    public function clickable(bool|Closure $clickable = true): static
    {
        $this->clickable = $clickable;

        return $this;
    }

    public function getClickable(): bool
    {
        return (bool) $this->isDisabled ? false : $this->evaluate($this->clickable);
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

    /**
     * @throws JsonException
     */
    public function getMapConfig(): array
    {
        return [
            'apiKey' => $this->getApiKey(),
            'language' => $this->getLanguage(),
            'controlTranslations' => $this->getControlTranslations(),
            'defaultLocation' => $this->getDefaultLocation(),
            'minZoomLevel' => $this->getMinZoomLevel(),
            'initialZoomLevel' => $this->getInitialZoomLevel(),
            'maxZoomLevel' => $this->getMaxZoomLevel(),
            'rateLimit' => $this->getRateLimit(),
            'rateLimitEvent' => $this->getRateLimitEvent(),
            'zoomable' => $this->getZoomable(),
            'geolocate' => $this->getGeolocate(),
            'style' => $this->getStyle(),
            'showStyleSwitcher' => $this->getShowStyleSwitcher(),
            'styleSwitcherLabel' => __('filament-map-tiler::filament-map-tiler.map_style'),
            'customStyles' => $this->getCustomStyles(),
            'customMarker' => $this->getCustomMarker(),
            'markerIconPath' => $this->getMarkerIconPath(),
            'markerShadowPath' => $this->getMarkerShadowPath(),
            'maxBounds' => $this->getMaxBounds(),
            'rotationable' => $this->getRotationable(),
            'hash' => $this->getHash(),
            // ? For field only
            'statePath' => $this->getStatePath(),
            'isDisabled' => $this->isDisabled(),
            'draggable' => $this->getDraggable(),
            'clickable' => $this->getClickable(),
            'searchLocationButtonLabel' => $this->getSearchLocationButtonLabel(),
        ];
    }
}
