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

    protected string|Closure|null $searchLocationButtonLabel = 'Search Location';

    protected bool|array|Closure $geolocate = false;

    protected bool|Closure $draggable = true;

    protected bool|Closure $clickable = true;

    protected array|Closure $rateLimit = [];

    protected ?Closure $onRateLimit = null;

    private int $precision = 8;

    protected function setUp(): void
    {
        parent::setUp();

        $this->afterStateHydrated(fn () => $this->ensureValidApiKey());
    }

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
            'customTiles' => $this->getCustomStyles(),
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
    ): static {
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
        $defaults = $this->getMapTilerConfig('geolocate_options');

        if ($value === false) {
            return array_merge($defaults, ['enabled' => false]);
        }

        if ($value === true) {
            return array_merge($defaults, ['enabled' => true]);
        }

        return array_merge($defaults, (array) $value);
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
        $defaults = $this->getMapTilerConfig('rate_limit_values');

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
