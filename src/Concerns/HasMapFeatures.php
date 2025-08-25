<?php

namespace GoodMaven\FilamentMapTiler\Concerns;

use Closure;

trait HasMapFeatures
{
    protected string|Closure $apiKey = '';
    
    protected string|Closure $height = '400px';

    protected string|Closure|null $language = null;

    protected array|Closure|null $defaultLocation = null;

    protected string $style = 'STREETS';

    protected bool $showStyleSwitcher = false;

    protected array $customTiles = [];
    
    protected ?array $customMarker = null;

    protected string|Closure $markerIconPath = '';

    protected string|Closure $markerShadowPath = '';

    protected int|Closure|null $defaultZoomLevel = null;
    
    protected array|Closure|null $maxBounds = null;

    protected bool|Closure $draggable = true;

    protected bool|Closure $zoomable = true;

    protected bool|Closure $clickable = true;
    
    protected bool|Closure $rotationable = true;

    protected array|Closure $rateLimit = [];

    protected ?Closure $onRateLimit = null;

    protected bool|Closure $hash = false;

    public function rotationable(bool|Closure $rotationable = true): static
    {
        $this->rotationable = $rotationable;

        return $this;
    }

    public function getRotationable(): bool
    {
        return (bool) $this->evaluate($this->rotationable);
    }
}
