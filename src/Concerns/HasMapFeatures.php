<?php

namespace GoodMaven\FilamentMapTiler\Concerns;

use Closure;

trait HasMapFeatures
{
    protected bool|Closure $rotationable = true;

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
