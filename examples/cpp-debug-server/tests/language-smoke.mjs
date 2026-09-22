// Module-level language test; no LSP transport, Unreal process or VS Code UI.
// Requires: npm ci --prefix language-server
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scriptPath } from './harness.mjs';

const root = fileURLToPath(new URL('../../../language-server/', import.meta.url));
const require = createRequire(new URL('../../../language-server/package.json', import.meta.url));
const esbuild = require('esbuild');
const cpp = await readFile(new URL('../src/main.cpp', import.meta.url), 'utf8');
const match = cpp.match(/R"json\(([\s\S]*?)\)json"/);
assert.ok(match, 'Expected the server\'s embedded DebugDatabase fixture');
const database = JSON.parse(match[1]);
const test = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import * as db from './src/database';
    import * as parser from './src/as_parser';
    import * as completion from './src/parsed_completion';
    db.AddTypesFromUnreal(${JSON.stringify(database)});
    db.FinishTypesFromUnreal();
    db.AddPrimitiveTypes(false);
    const module = parser.GetOrCreateModule('Demo', ${JSON.stringify(scriptPath)},
        ${JSON.stringify(pathToFileURL(scriptPath).href)});
    parser.UpdateModuleFromContent(module, fs.readFileSync(${JSON.stringify(scriptPath)}, 'utf8'));
    parser.ParseModule(module, true);
    parser.PostProcessModuleTypes(module);
    parser.ResolveModule(module);
    assert.equal(module.rawStatements.some(statement => statement.parseError), false);
    function at(prefix) {
        return module.getPosition(module.content.indexOf(prefix) + prefix.length);
    }
    let items = completion.Complete(module, at('Demo::'));
    assert.ok(items.some(item => item.label === 'Print'));
    assert.ok(items.some(item => item.label === 'State'));
    items = completion.Complete(module, at('Demo::State.'));
    assert.ok(items.some(item => item.label === 'LastResult'));
    assert.ok(items.some(item => item.label === 'ExecutedInstructions'));
    const signature = completion.Signature(module, at('Demo::Print('));
    assert.ok(signature.signatures[0].label.includes('int64 Value'));
    console.log('PASS: real parser/database/completion/signature modules with the C++ API fixture.');
`;
const built = esbuild.buildSync({
    stdin: { contents: test, loader: 'ts', resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error',
});
// Execute only the bundled test above; Demo.as is parsed, never executed as JS.
new Function('require', built.outputFiles[0].text)(require);
