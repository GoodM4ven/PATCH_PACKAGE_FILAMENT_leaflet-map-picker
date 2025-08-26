<?php

return [

    'api_key' => env('FILAMENT_MAPTILER_API_KEY', ''),

    'defaults' => [

        'location' => [
            'lat' => 34.890832,
            'lng' => 38.542143,
        ],

        'zoom_level' => [
            'min' => false,
            'initial' => 10,
            'max' => false,
        ],

        'geolocate_options' => [
            'enabled' => false,
            'runOnLoad' => false,
            'pinAsWell' => false,
            'cacheInMs' => 5 * 60 * 1000, // ? 5 minutes
        ],

        'rate_limit_values' => [
            'interval' => 60_000, // ? 1 minute
            'geolocate' => 5,
            'zoom' => 360,
            'pinMove' => 20,
            'cameraMove' => 80,
            'search' => 10,
        ],

    ],

];
