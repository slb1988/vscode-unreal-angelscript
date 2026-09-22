const esbuild = require("esbuild");
const fs = require("node:fs");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build extension started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build extension finished');
		});
	},
};

async function main() {
	// The bundled language client loads this helper relative to extension.js on Unix.
	fs.mkdirSync('dist', { recursive: true });
	fs.copyFileSync(require.resolve('vscode-languageclient/lib/node/terminateProcess.sh'), 'dist/terminateProcess.sh');
	fs.chmodSync('dist/terminateProcess.sh', 0o755);
	fs.copyFileSync(require.resolve('vscode-languageclient/License.txt'), 'dist/languageclient-LICENSE.txt');
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts',
			'src/debugAdapter.ts',
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outdir: 'dist',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});