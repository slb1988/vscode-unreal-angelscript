// Run from the repository root: node language-server/tests/async-await.test.mjs
// No LSP transport, Unreal process or VS Code window is started.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { buildSync } = require('esbuild');
const directory = fileURLToPath(new URL('.', import.meta.url));
const built = buildSync({
    entryPoints: [fileURLToPath(new URL('async-await.test.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error',
});
new Function('require', '__dirname', built.outputFiles[0].text)(require, directory);

// Optional npm-exec packages keep the extension's dependencies unchanged.
if (process.argv.includes('--textmate')) {
    function tool(name) {
        for (const bin of (process.env.PATH || '').split(path.delimiter)) {
            const candidate = createRequire(path.resolve(bin, '../package.json'));
            try { return candidate.resolve(name); } catch {}
        }
        return require.resolve(name);
    }
    const textmate = require(tool('vscode-textmate'));
    const oniguruma = require(tool('vscode-oniguruma'));
    const wasm = fs.readFileSync(tool('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
            createOnigString: text => new oniguruma.OnigString(text),
        }),
        loadGrammar: async scope => {
            const name = scope.replace('source.', '');
            const filename = path.resolve(directory, `../../extension/syntaxes/${name}.tmLanguage.json`);
            return textmate.parseRawGrammar(fs.readFileSync(filename, 'utf8'), filename);
        },
    });
    const grammar = await registry.loadGrammar('source.angelscript');
    const cases = [
        ['async FTask RunAsync(UPLAutomationAsyncContext T)', 'async', 'keyword.type.angelscript'],
        ['await UISteps::WaitForWidgetActive("Menu", 90.f);', 'await', 'keyword.statement.angelscript'],
        ['// await UISteps::WaitForWidgetActive("Menu", 90.f);', 'await', 'comment.line.double-slash.angelscript'],
        ['"await UISteps::WaitForWidgetActive"', 'await', 'string.quoted.double.angelscript'],
        ['int async = 1;', 'async', null],
        ['int await = 2;', 'await', null],
        ['await(1);', 'await', null],
        ['awaitValue();', 'awaitValue', null],
        ['asyncValue();', 'asyncValue', null],
    ];
    for (const [line, word, scope] of cases) {
        const offset = line.indexOf(word);
        const token = grammar.tokenizeLine(line).tokens.find(t => t.startIndex <= offset && t.endIndex > offset);
        if (scope) assert.ok(token.scopes.includes(scope), `${line}: ${token.scopes}`);
        else assert.ok(!token.scopes.some(s => s.startsWith('keyword.')), `${line}: ${token.scopes}`);
    }
    registry.dispose();
    console.log(`PASS: ${cases.length} real TextMate/Oniguruma keyword, identifier, string and comment cases`);
}
