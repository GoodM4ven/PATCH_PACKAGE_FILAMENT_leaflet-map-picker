<x-dynamic-component
    :component="$getFieldWrapperView()"
    :field="$field"
>
    <div
        wire:ignore
        x-load
        x-load-css="[@js(\Filament\Support\Facades\FilamentAsset::getStyleHref('filament-map-tiler', 'goodm4ven/filament-map-tiler'))]"
        x-load-src="{{ \Filament\Support\Facades\FilamentAsset::getAlpineComponentSrc('map-tiler-field', 'goodm4ven/filament-map-tiler') }}"
        wire:key="{{ $getStatePath() }}"
        x-data="mapTilerPicker({ config: @js($getMapConfig()) })"
        x-on:livewire:update.window="updateMapFromAlpine()"
        x-ignore
    >
        <div class="relative mx-auto w-full overflow-hidden rounded-lg bg-gray-50 shadow dark:bg-gray-700">
            <div
                class="map-tiler relative w-full"
                style="height: {{ $getHeight() }}; z-index: 1;"
                x-ref="mapContainer"
            ></div>

            <div
                class="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700"
                x-show="lat !== null && lng !== null"
            >
                <div class="flex items-center">
                    <svg
                        class="mr-2 h-5 w-5 text-gray-500 dark:text-gray-200"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                    </svg>
                    <p class="text-sm text-gray-700 dark:text-gray-200">
                        {{ __('filament-map-tiler::filament-map-tiler.selected_locations') }}
                        <span
                            class="font-medium"
                            x-text="lat ? lat.toFixed(6) : ''"
                        ></span>,
                        <span
                            class="font-medium"
                            x-text="lng ? lng.toFixed(6) : ''"
                        ></span>
                    </p>
                </div>
            </div>
        </div>

        <x-filament::modal
            id="location-search-modal"
            slide-over
            width="md"
            x-on:open-modal.window="if ($event.detail.id === 'location-search-modal') { $store.mt.searchQuery = ''; $store.mt.localSearchResults = [] }"
        >
            <x-slot name="heading">
                {{ __('filament-map-tiler::filament-map-tiler.search_location') }}
            </x-slot>

            <div class="space-y-4">
                <div class="relative">
                    <x-filament::input.wrapper suffix-icon="heroicon-m-magnifying-glass">
                        <x-filament::input
                            type="text"
                            x-model="$store.mt.searchQuery"
                            x-on:input="debounceSearch()"
                            placeholder="{{ __('filament-map-tiler::filament-map-tiler.search_placeholder') }}"
                        />
                    </x-filament::input.wrapper>
                </div>

                {{-- loading --}}
                <div
                    class="flex justify-center py-4"
                    x-show="$store.mt.isSearching"
                >
                    <x-filament::loading-indicator class="h-5 w-5" />
                </div>

                <!-- Search results -->
                <div
                    class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-700"
                    x-show="$store.mt.localSearchResults.length > 0 && !$store.mt.isSearching"
                    x-cloak
                >
                    <ul class="overflow-auto">
                        <template
                            x-for="(result, index) in $store.mt.localSearchResults"
                            :key="index"
                        >
                            <li class="transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800">
                                <button
                                    class="flex w-full items-start gap-3 px-4 py-3 text-left"
                                    type="button"
                                    @click="selectLocationFromModal(result); $dispatch('close-modal', { id: 'location-search-modal' })"
                                >
                                    <div class="mt-0.5 flex-shrink-0">
                                        <svg
                                            class="text-primary-500 h-5 w-5"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                            />
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                            />
                                        </svg>
                                    </div>
                                    <div>
                                        <p
                                            class="text-sm font-medium text-gray-800 dark:text-gray-200"
                                            x-text="result.display_name || result.name"
                                        ></p>
                                    </div>
                                </button>
                            </li>
                        </template>
                    </ul>
                </div>

                <!-- No results message -->
                <div
                    class="rounded-lg bg-gray-50 p-4 text-center dark:bg-gray-700"
                    x-show="$store.mt.searchQuery && $store.mt.searchQuery.length > 2 && $store.mt.localSearchResults.length === 0 && !$store.mt.isSearching"
                >
                    <svg
                        class="mx-auto h-6 w-6 text-gray-400 dark:text-gray-300"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                    <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        {{ __('filament-map-tiler::filament-map-tiler.no_results') }}
                    </p>
                </div>
            </div>

            <x-slot name="footer">
                <x-filament::button
                    color="gray"
                    @click="$dispatch('close-modal', { id: 'location-search-modal' })"
                >
                    {{ __('filament-map-tiler::filament-map-tiler.cancel') }}
                </x-filament::button>
            </x-slot>
        </x-filament::modal>
    </div>
</x-dynamic-component>
