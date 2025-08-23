<?php

namespace GoodMaven\FilamentMapTiler\Concerns;

use Closure;

trait HasMapFeatures
{
    protected bool|Closure $rotationable = true;

    protected bool|Closure $geolocate = false;

    public function rotationable(bool|Closure $rotationable = true): static
    {
        $this->rotationable = $rotationable;

        return $this;
    }

    public function getRotationable(): bool
    {
        return (bool) $this->evaluate($this->rotationable);
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
}
