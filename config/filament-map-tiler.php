<?php

return [
    'api_key' => env('FILAMENT_MAPTILER_API_KEY', ''),

    'default_location' => [
        'lat' => 34.890832,
        'lng' => 38.542143,
    ],

    'default_zoom' => 13,

    'geolocate' => [
        'enabled' => false,
        'runOnLoad' => false,
        'pinAsWell' => true,
        'cacheInMs' => 5 * 60 * 1000,
    ],

    'rate_limit' => [
        'interval' => 60_000,
        'geolocate' => 5,
        'zoom' => 360,
        'pinMove' => 60,
        'cameraMove' => 80,
        'search' => 10,
    ],
];
