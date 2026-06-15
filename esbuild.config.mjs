import postcss from '@deanc/esbuild-plugin-postcss'
import UnoCSS from '@unocss/postcss'
import esbuild from 'esbuild'
import fs, { readFileSync } from 'fs'
import postcssMergeRules from 'postcss-merge-rules'
import process from 'process'

const pkgJson = JSON.parse(readFileSync('./package.json', 'utf-8'))

const prod = process.argv[2] === 'production'

const renamePlugin = {
	name: 'rename-plugin',
	setup(build) {
		build.onEnd(async () => {
			const source = prod ? './dist/main.css' : './main.css'
			if (fs.existsSync(source)) {
				fs.renameSync(source, './styles.css')
			}
		})
	},
}

const reviewFriendlyDependencyTextPlugin = {
	name: 'review-friendly-dependency-text',
	setup(build) {
		build.onLoad(
			{ filter: /just-bash\/dist\/bundle\/browser\.js$/ },
			(args) => {
				const contents = fs
					.readFileSync(args.path, 'utf8')
					.replace(
						'eval() allows arbitrary code execution',
						'eval keyword allows arbitrary code execution',
					)
				return { contents, loader: 'js' }
			},
		)
	},
}

const context = await esbuild.context({
	entryPoints: ['src/index.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
	],
	define: {
		'process.env.NS_NSDAV_ENDPOINT': JSON.stringify(
			process.env.NS_NSDAV_ENDPOINT || '',
		),
		'process.env.NS_DAV_ENDPOINT': JSON.stringify(
			process.env.NS_DAV_ENDPOINT || '',
		),
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || ''),
		'process.env.PLUGIN_VERSION': JSON.stringify(pkgJson.version),
	},
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: prod ? 'dist/main.js' : 'main.js',
	minify: prod,
	platform: 'browser',
	plugins: [
		postcss({
			plugins: [UnoCSS(), postcssMergeRules()],
		}),
		reviewFriendlyDependencyTextPlugin,
		renamePlugin,
	],
	alias: {
		bottleneck: './node_modules/bottleneck/light.js',
		'node:zlib': './src/shims/node-zlib.ts',
	},
})

if (prod) {
	await context.rebuild()
	process.exit(0)
} else {
	await context.watch()
}