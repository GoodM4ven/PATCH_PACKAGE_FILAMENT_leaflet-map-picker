# FilamentPHP MapTiler Field

A Filament Forms component that provides an interactive MapTiler map for various geographical actions...

## Todos

- Interactive map for coordinates search and selection
- ...

## Installation

1. Install the package via composer:

   ```bash
   composer require goodm4ven/filament-map-tiler

   php artisan vendor:publish --tag="filament-map-tiler-config"
   ```

2. Ensure that a valid [MapTiler](https://maptiler.com) API key is given out from the environment.

   ```env
   MAPTILER_API_KEY="..."
   ```

3. (Optional) You can publish the lang and views files using:

   ```bash
   php artisan vendor:publish --tag="filament-map-tiler-translations"
   php artisan vendor:publish --tag="filament-map-tiler-views"
   ```

## Preparation

1. Create a column in your model's migration table to store the location data.

   ```php
   Schema::create('somethings', function (Blueprint $table) {
       // ...
       $table->text('location')->nullable(); // JSON stuff
       // OR
       $table->json('location')->nullable();
       // ...
   });
   ```

2. Prepare the model for location storage. Data is a JSON string.

   ```php
   class Something extends Model
   {
       protected $fillable = [
           'location',
       ];
   
       protected $casts = [
           'location' => 'array',
       ];
   }
   ```

## Usage

1. To show the interactive map, add its [Forms](https://filamentphp.com/docs/fields) field to your Livewire component.

   ```php
   use GoodMaven\FilamentMapTiler\MapTilerField;
   // ...
   MapTilerField::make('location')
       ->apiKey('ANOTHER_MAPTILER_API_KEY') // overrides the one set in [.env]
       ->defaultLocation([35.926963, 36.667496]), // defaults to Idlib, Syria!
       ->tileProvider('STREETS') // defaults to `STREETS`; other options: OUTDOOR, WINTER, SATELLITE, HYBRID...
       ->hideTileControl() // hide style selector, shown by default
       ->clickable(false) // defaults to `true`
       ->draggable(false) // defaults to `true`
       ->defaultZoom(18) // defaults to `13`
       ->language('FRENCH') // change map labels language
       ->geolocate() // center map to visitor's location
       ->hash() // keep map view in the URL hash
       ->disableRotation() // prevent map rotation
       ->maxBounds([[-74.1,40.7],[-73.9,40.9]]) // restrict map panning
       ->height('700px') // defaults to `400px`
       ->customMarker([
           'iconUrl' => asset('images/map-tiler/new-pin.png'),
           'iconSize' => [40, 40],
           'iconAnchor' => [20, 40],
           'popupAnchor' => [0, -40],
       ]),
   ```

2. When you only wish to display the location, you'd use an [info-list](https://filamentphp.com/docs/3.x/infolists) component instead:

   ```php
   use GoodMaven\FilamentMapTiler\MapTilerEntry;
   // ...
   MapTilerEntry::make('location')
       ->apiKey('ANOTHER_MAPTILER_API_KEY') // overrides the one set in [.env]
       ->defaultLocation([35.926963, 36.667496]), // defaults to Idlib, Syria!
       ->tileProvider('STREETS') // defaults to `STREETS`; other options: OUTDOOR, WINTER, SATELLITE, HYBRID...
       ->hideTileControl()
       ->language('SPANISH')
       ->hash()
       ->geolocate()
       ->disableRotation()
       ->height('700px') // defaults to `400px`
       ->customMarker([
           'iconUrl' => asset('images/map-tiler/new-pin.png'),
           'iconSize' => [40, 40],
           'iconAnchor' => [20, 40],
           'popupAnchor' => [0, -40],
       ])
   ```

## Credits

- [GoodM4ven](https://github.com/GoodM4ven)
- [Azad Furkan ŞAKAR](https://github.com/afsakar)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
