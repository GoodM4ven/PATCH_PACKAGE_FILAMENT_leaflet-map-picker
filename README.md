# FilamentPHP MapTiler Field

A Filament Forms component that provides an interactive MapTiler map for selecting and storing geographical coordinates.

## Todos

- Interactive map for location selection
- Customizable map height
- Default location configuration
- Adjustable zoom level
- Draggable and clickable markers
- "My Location" button for quick navigation to user's current position
- Support for different tile providers (OpenStreetMap by default)
- Custom tile layer support
- Custom marker configuration

## Installation

You can install the package via composer:

```bash
composer require goodm4ven/filament-map-tiler

php artisan vendor:publish --tag="filament-map-tiler-assets"
```

### Database Migration

Create a column in your table to store the location data. You can use a `text` or `json` column type:

```php
Schema::create('somethings', function (Blueprint $table) {
    // ...
    $table->text('location')->nullable(); // Stores coordinates as JSON string
    // OR
    $table->json('location')->nullable();
    // ...
});
```

### Preparing the models

To use the MapTiler field component, you need to prepare your database and model to store geographical coordinates. The component stores location data as a JSON string in the format `[lat, lng]`.

```php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Something extends Model
{
    protected $fillable = [
        // ...
        'location',
    ];

    protected $casts = [
        // ...
        'location' => 'array',
    ];
}
```

You can publish the lang files with:
```bash
php artisan vendor:publish --tag="filament-map-tiler-translations"
```

Optionally, you can also publish the views using:
```bash
php artisan vendor:publish --tag="filament-map-tiler-views"
```

## Usage

### Form
```php
use GoodMaven\FilamentMapTiler\MapTiler;

// Basic usage
MapTiler::make('location')
    ->label('Select Location')

// Advanced usage with customization
MapTiler::make('location')
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
use GoodMaven\FilamentMapTiler\MapTilerEntry;

// Basic usage
MapTilerEntry::make('location')
    ->label('Location')

// Advanced usage with customization
MapTilerEntry::make('location')
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

...

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

- [GoodM4ven](https://github.com/GoodM4ven)
- [Azad Furkan ŞAKAR](https://github.com/afsakar)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
