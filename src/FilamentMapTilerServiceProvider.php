<?php

namespace GoodMaven\FilamentMapTiler;

use Filament\Support\Assets\AlpineComponent;
use Filament\Support\Assets\Css;
use Filament\Support\Facades\FilamentAsset;
use Spatie\LaravelPackageTools\Commands\InstallCommand;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;

class FilamentMapTilerServiceProvider extends PackageServiceProvider
{
    public static string $name = 'filament-map-tiler';

    public static string $viewNamespace = 'filament-map-tiler';

    public function configurePackage(Package $package): void
    {
        /*
         * This class is a Package Service Provider
         *
         * More info: https://github.com/spatie/laravel-package-tools
         */
        $package->name(static::$name)
            ->hasInstallCommand(function (InstallCommand $command) {
                $command
                    ->publishConfigFile()
                    ->askToStarRepoOnGitHub('GoodM4ven/PACKAGE_FILAMENT_map-tiler');
            });

        $configFileName = static::$name;

        if (file_exists($package->basePath("/../config/{$configFileName}.php"))) {
            $package->hasConfigFile();
        }

        if (file_exists($package->basePath('/../resources/lang'))) {
            $package->hasTranslations();
        }

        if (file_exists($package->basePath('/../resources/views'))) {
            $package->hasViews(static::$viewNamespace);
        }
    }

    public function packageRegistered(): void {}

    public function packageBooted(): void
    {
        // Asset Registration
        FilamentAsset::register(
            assets: [
                Css::make(
                    'filament-map-tiler',
                    __DIR__ . '/../resources/dist/filament-map-tiler.css'
                )->loadedOnRequest(),
                AlpineComponent::make('map-tiler-field', __DIR__ . '/../resources/dist/field.js'),
                AlpineComponent::make('map-tiler-entry', __DIR__ . '/../resources/dist/entry.js'),
            ],
            package: 'GoodM4ven/PACKAGE_FILAMENT_map-tiler',
        );

        $this->publishes([
            __DIR__ . '/../resources/dist/images' => public_path('vendor/filament-map-tiler/images'),
        ], 'filament-map-tiler-assets');
    }

    protected function getAssetPackageName(): ?string
    {
        return 'GoodM4ven/PACKAGE_FILAMENT_map-tiler';
    }
}
