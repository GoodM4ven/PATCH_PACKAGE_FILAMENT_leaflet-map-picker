/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./resources/views/**/*.blade.php', './resources/js/**/*.js', './src/**/*.php'],
    darkMode: 'class',
    corePlugins: {
        preflight: false,
    },
    plugins: [],
};
