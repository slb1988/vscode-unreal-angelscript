// Runs the repository's REAL ASDebugSession against the C++ demo.
// Only the VS Code workspace/settings API is stubbed; no VS Code UI is launched.
// Requires: npm ci --prefix extension
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DapClient, lines, scriptPath, scriptRoot, startServer, stopProcess } from './harness.mjs';

const extensionRoot = fileURLToPath(new URL('../../../extension/', import.meta.url));
const require = createRequire(path.join(extensionRoot, 'package.json'));
const esbuild = require('esbuild');
const temporary = await mkdtemp(path.join(tmpdir(), 'as-demo-dap-'));
let server, host;
let adapterLog = '';
try {
    const outfile = path.join(temporary, 'adapter.cjs');
    await esbuild.build({
        stdin: {
            contents: `
                import { ASDebugSession } from './src/debug';
                const session = new ASDebugSession();
                session.hostname = '127.0.0.1';
                session.port = Number(process.env.DEMO_PORT);
                session.start(process.stdin, process.stdout);
            `,
            resolveDir: extensionRoot, loader: 'ts', sourcefile: 'demo-adapter-host.ts',
        },
        bundle: true, platform: 'node', format: 'cjs', outfile,
        plugins: [{
            name: 'test-only-workspace',
            setup(build) {
                build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'test' }));
                build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
                    contents: `export const workspace = {
                        workspaceFolders: [{uri: {fsPath: process.env.DEMO_SCRIPT_ROOT}}],
                        getConfiguration() { return {get() { return undefined; }}; }
                    };`, loader: 'js',
                }));
            },
        }],
    });
    server = await startServer(process.argv[2]);
    host = spawn(process.execPath, [outfile], {
        env: { ...process.env, DEMO_PORT: String(server.port), DEMO_SCRIPT_ROOT: path.resolve(scriptRoot) },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    host.stderr.on('data', chunk => { adapterLog = (adapterLog + chunk).slice(-100000); });
    const dap = new DapClient(host);
    const capabilities = await dap.request('initialize', {
        clientID: 'cpp-demo-smoke', adapterID: 'angelscript', pathFormat: 'path',
        linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true,
    });
    assert.equal(capabilities.supportsConfigurationDoneRequest, true);
    assert.deepEqual(capabilities.exceptionBreakpointFilters, []);
    await dap.event('initialized');

    // Real clients send configuration requests while launch waits for configurationDone.
    const launch = dap.request('launch', { hostname: '127.0.0.1', port: server.port, trace: false });
    launch.catch(() => {}); // the awaited launch below still reports a failure
    const breakpoints = await dap.request('setBreakpoints', {
        source: { path: scriptPath }, lines: [lines.call], breakpoints: [{ line: lines.call }],
    });
    assert.equal(breakpoints.breakpoints[0].verified, true);
    await dap.request('setExceptionBreakpoints', { filters: [] });
    await dap.request('configurationDone');
    await launch;
    assert.equal((await dap.event('stopped')).body.reason, 'entry');
    let stack = await dap.request('stackTrace', { threadId: 1 });
    assert.equal(stack.stackFrames[0].line, lines.init);
    assert.equal(path.resolve(stack.stackFrames[0].source.path), path.resolve(scriptPath));

    const run = async (command, reason) => {
        await dap.request(command, { threadId: 1 });
        await dap.event('continued');
        assert.equal((await dap.event('stopped')).body.reason, reason);
    };
    await run('continue', 'breakpoint');
    let scopes = await dap.request('scopes', { frameId: 0 });
    assert.deepEqual(scopes.scopes.map(s => s.name), ['Variables', 'this', 'Globals']);
    const localReference = scopes.scopes[0].variablesReference;
    let variables = await dap.request('variables', { variablesReference: localReference });
    assert.equal(variables.variables.find(v => v.name === 'Counter').value, '1');
    assert.equal((await dap.request('evaluate', { expression: 'Counter', frameId: 0, context: 'watch' })).result, '1');
    assert.equal((await dap.request('dataBreakpointInfo', { variablesReference: localReference, name: 'Counter' })).dataId, null);

    await run('stepIn', 'step');
    stack = await dap.request('stackTrace', { threadId: 1 });
    assert.deepEqual(stack.stackFrames.map(f => f.name), ['Add', 'Main']);
    assert.equal(stack.stackFrames[0].line, lines.add);
    assert.equal((await dap.request('evaluate', { expression: 'Counter', frameId: 1, context: 'watch' })).result, '1');
    await run('next', 'step');
    assert.equal((await dap.request('evaluate', { expression: 'Result', frameId: 0, context: 'hover' })).result, '3');
    await run('stepOut', 'step');
    stack = await dap.request('stackTrace', { threadId: 1 });
    assert.equal(stack.stackFrames.length, 1);
    assert.equal(stack.stackFrames[0].line, lines.store);
    await run('next', 'step');
    const state = await dap.request('evaluate', { expression: 'Demo::State', frameId: 0, context: 'watch' });
    assert.ok(state.variablesReference > 0);
    variables = await dap.request('variables', { variablesReference: state.variablesReference });
    assert.equal(variables.variables.find(v => v.name === 'LastResult').value, '3');
    scopes = await dap.request('scopes', { frameId: 0 });
    const globals = await dap.request('variables', { variablesReference: scopes.scopes[2].variablesReference });
    variables = await dap.request('variables', { variablesReference: globals.variables[0].variablesReference });
    assert.equal(variables.variables.find(v => v.name === 'LastResult').value, '3');

    await dap.request('setBreakpoints', { source: { path: scriptPath }, lines: [], breakpoints: [] });
    await dap.request('continue', { threadId: 1 }); await dap.event('continued');
    await dap.request('pause', { threadId: 1 });
    assert.equal((await dap.event('stopped')).body.reason, 'pause');
    await dap.request('disconnect', { restart: false, terminateDebuggee: false });
    console.log('PASS: real ASDebugSession DAP initialize/launch/configuration, breakpoints, stack/scopes/variables, Watch/hover, step in/over/out, pause and disconnect.');
} catch (error) {
    console.error(server?.logs() ?? '', adapterLog);
    throw error;
} finally {
    if (host) await stopProcess(host);
    if (server) await server.close();
    await rm(temporary, { recursive: true, force: true });
}
