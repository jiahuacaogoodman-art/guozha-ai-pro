import { defineConfig, presetWind3 } from 'unocss'

export default defineConfig({
	content: {
		filesystem: ['src/**/*.{html,js,ts,jsx,tsx,vue,svelte,astro}'],
	},
	rules: [[/^background-none$/, () => ({ background: 'none' })]],
	presets: [presetWind3()],
})