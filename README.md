# FilamentPHP MapTiler Field

A Filament Forms component that provides an interactive MapTiler map for selecting and storing geographical coordinates.

[![Latest Version on Packagist](https://img.shields.io/packagist/v/GoodM4ven/PACKAGE_FILAMENT_map-tiler.svg?style=flat-square)](https://packagist.org/packages/GoodM4ven/PACKAGE_FILAMENT_map-tiler)
[![GitHub Tests Action Status](https://img.shields.io/github/actions/workflow/status/GoodM4ven/PACKAGE_FILAMENT_map-tiler/run-tests.yml?branch=main&label=tests&style=flat-square)](https://github.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/actions?query=workflow%3Arun-tests+branch%3Amain)
[![GitHub Code Style Action Status](https://img.shields.io/github/actions/workflow/status/GoodM4ven/PACKAGE_FILAMENT_map-tiler/fix-php-code-styling.yml?branch=main&label=code%20style&style=flat-square)](https://github.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/actions?query=workflow%3A"Fix+PHP+code+styling"+branch%3Amain)
[![Total Downloads](https://img.shields.io/packagist/dt/GoodM4ven/PACKAGE_FILAMENT_map-tiler.svg?style=flat-square)](https://packagist.org/packages/GoodM4ven/PACKAGE_FILAMENT_map-tiler)

![Banner](https://raw.githubusercontent.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/main/art/leaflet-js-banner.png "Banner")

## Features

- Interactive map for location selection
- Customizable map height
- Default location configuration
- Adjustable zoom level
- Draggable and clickable markers
- "My Location" button for quick navigation to user's current position
- Support for different tile providers (OpenStreetMap by default)
- Custom tile layer support
- Custom marker configuration

![Screenshot](https://raw.githubusercontent.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/main/art/sc-default.png "Default")

## Installation

You can install the package via composer:

```bash
composer require GoodM4ven/PACKAGE_FILAMENT_map-tiler

php artisan vendor:publish --tag="filament-map-tiler-assets"
```

### Database Migration

Create a column in your table to store the location data. You can use a `text` or `json` column type:

```php
Schema::create('properties', function (Blueprint $table) {
    $table->id();
    // Other columns
    $table->text('location')->nullable(); // Stores coordinates as JSON string
    // OR
    $table->json('location')->nullable(); // Alternative approach
    $table->timestamps();
});
```

### Preparing the models

To use the LeafletMapPicker component, you need to prepare your database and model to store geographical coordinates. The component stores location data as a JSON string in the format `[lat, lng]`.

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Property extends Model
{
    protected $fillable = [
        // Other fillable fields
        'location',
    ];

    protected $casts = [
        'location' => 'array',
    ];
}
```

You can publish the lang files with:

```bash
php artisan vendor:publish --tag="filament-map-tiler-translations"
```

Optionally, you can publish the views using

```bash
php artisan vendor:publish --tag="filament-map-tiler-views"
```

## Usage

### Form
```php
use GoodMaven\FilamentMapTiler\LeafletMapPicker;

// Basic usage
LeafletMapPicker::make('location')
    ->label('Select Location')

// Advanced usage with customization
LeafletMapPicker::make('location')
    ->label('Property Location')
    ->height('500px')
    ->defaultLocation([41.0082, 28.9784]) // Istanbul coordinates
    ->defaultZoom(15)
    ->draggable() // default true
    ->clickable() // default true
    ->myLocationButtonLabel('Go to My Location')
    ->hideTileControl()
    ->readOnly() // default false, when you set this to true, the marker will not be draggable or clickable and current location and search location buttons will be hidden
    ->apiKey('YOUR_MAPTILER_API_KEY')
    ->tileProvider('STREETS') // built-in options: STREETS, OUTDOOR, WINTER, SATELLITE, HYBRID, etc.
    ->customMarker([
        'iconUrl' => asset('pin-2.png'),
        'iconSize' => [38, 38],
        'iconAnchor' => [19, 38],
        'popupAnchor' => [0, -38]
    ])
```

### Infolist

```php
use GoodMaven\FilamentMapTiler\LeafletMapPickerEntry;

// Basic usage
LeafletMapPickerEntry::make('location')
    ->label('Location')

// Advanced usage with customization
LeafletMapPickerEntry::make('location')
    ->label('Property Location')
    ->height('500px')
    ->defaultLocation([41.0082, 28.9784])
    ->apiKey('YOUR_MAPTILER_API_KEY')
    ->tileProvider('STREETS') // built-in options: STREETS, OUTDOOR, WINTER, SATELLITE, HYBRID, etc.
    ->hideTileControl()
    ->customMarker([
        'iconUrl' => asset('pin-2.png'),
        'iconSize' => [38, 38],
        'iconAnchor' => [19, 38],
        'popupAnchor' => [0, -38]
    ])
```

## Screenshots

Default:
![Screenshot](https://raw.githubusercontent.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/main/art/sc-default.png "Default")

Custom Marker:
![Screenshot](https://raw.githubusercontent.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/main/art/sc-custom-marker.png "Custom Marker")

Custom Tile:
![Screenshot](https://raw.githubusercontent.com/GoodM4ven/PACKAGE_FILAMENT_map-tiler/main/art/sc-custom-tile.png "Custom Tile")

## Testing

```bash
composer test
```

## Changelog

Please see [CHANGELOG](CHANGELOG.md) for more information on what has changed recently.

## Contributing

Please see [CONTRIBUTING](.github/CONTRIBUTING.md) for details.

## Security Vulnerabilities

Please review [our security policy](../../security/policy) on how to report security vulnerabilities.

## Credits

- [Azad Furkan ŞAKAR](https://github.com/afsakar)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
