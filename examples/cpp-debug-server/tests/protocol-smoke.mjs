// No npm dependencies: exercises the C++ binary through real loopback TCP sockets.
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { Inbox, lines, scriptPath, startServer } from './harness.mjs';

const type = {
    requestDatabase: 1, database: 2, start: 3, stop: 4, pause: 5, continue: 6,
    requestStack: 7, stack: 8, clear: 9, breakpoint: 10, stopped: 11, continued: 12,
    over: 13, into: 14, out: 15, requestVariables: 17, variables: 18,
    requestEvaluate: 19, evaluate: 20, filters: 23, breakFilters: 24,
    disconnect: 25, databaseFinished: 26, settings: 31, version: 33,
};
const i32 = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const str = value => {
    // Mirror the current TS client writer; demo requests use ASCII only.
    const b = Buffer.from(value + '\0', 'latin1');
    return Buffer.concat([i32(b.length), b]);
};
const packet = (id, ...parts) => {
    const payload = Buffer.concat(parts);
    return Buffer.concat([i32(payload.length + 1), Buffer.from([id]), payload]);
};
class Reader {
    offset = 0;
    constructor(payload) { this.payload = payload; }
    int() { const n = this.payload.readInt32LE(this.offset); this.offset += 4; return n; }
    string() {
        const size = this.int();
        assert.ok(size > 0 && this.offset + size <= this.payload.length);
        const text = this.payload.subarray(this.offset, this.offset + size - 1).toString('utf8');
        this.offset += size;
        return text;
    }
    done() { assert.equal(this.offset, this.payload.length, 'Unexpected trailing fields'); }
}
class WireClient {
    inbox = new Inbox();
    pending = Buffer.alloc(0);
    constructor(socket) {
        this.socket = socket;
        socket.on('data', chunk => {
            try {
                this.pending = Buffer.concat([this.pending, chunk]);
                while (this.pending.length >= 5) {
                    const length = this.pending.readUInt32LE(0); // replies EXCLUDE type
                    assert.ok(length <= 65536);
                    if (this.pending.length < length + 5) break;
                    this.inbox.push({ type: this.pending[4], payload: this.pending.subarray(5, length + 5) });
                    this.pending = this.pending.subarray(length + 5);
                }
            } catch (error) { this.inbox.fail(error); }
        });
        socket.on('error', error => this.inbox.fail(error));
        socket.on('close', () => this.inbox.fail(new Error('Connection closed')));
    }
    send(id, ...parts) { this.socket.write(packet(id, ...parts)); }
    async receive(id) { return new Reader((await this.inbox.next(m => m.type === id, `wire ${id}`)).payload); }
    async stopped(reason) {
        const p = await this.receive(type.stopped);
        assert.equal(p.string(), reason); p.string(); p.string(); p.done();
    }
    async stack() {
        this.send(type.requestStack);
        const p = await this.receive(type.stack);
        const frames = Array.from({ length: p.int() }, () => ({
            name: p.string(), file: p.string(), line: p.int(), module: p.string(),
        }));
        p.done(); return frames;
    }
    async variables(path) {
        this.send(type.requestVariables, str(path));
        const p = await this.receive(type.variables);
        const values = Array.from({ length: p.int() }, () => readValue(p));
        p.done(); return values;
    }
    async evaluate(expression, frame = 0) {
        this.send(type.requestEvaluate, str(expression), i32(frame));
        const p = await this.receive(type.evaluate), value = readValue(p);
        p.done(); return value;
    }
    async run(id, reason) {
        this.send(id); (await this.receive(type.continued)).done(); await this.stopped(reason);
    }
}
function readValue(p) { return { name: p.string(), text: p.string(), type: p.string(), members: p.int() !== 0 }; }

const server = await startServer(process.argv[2]);
const sockets = [];
async function connect() {
    const socket = net.createConnection({ host: '127.0.0.1', port: server.port });
    sockets.push(socket);
    const client = new WireClient(socket);
    await once(socket, 'connect');
    return client;
}
try {
    // LSP stays connected while initialize's temporary socket is opened/closed.
    const lsp = await connect();
    const request = packet(type.requestDatabase);
    lsp.socket.write(request.subarray(0, 2));
    await new Promise(resolve => setTimeout(resolve, 15));
    lsp.socket.write(request.subarray(2));
    const settings = await lsp.receive(type.settings);
    assert.equal(settings.int(), 1); assert.equal(settings.int(), 1); settings.done();
    const dbPacket = await lsp.receive(type.database);
    const database = JSON.parse(dbPacket.string()); dbPacket.done();
    assert.equal(database.__Demo.methods.Print.args[0].type, 'int64');
    assert.equal(database.FDemoState.properties.LastResult[0], 'int64');
    (await lsp.receive(type.databaseFinished)).done();
    const initialize = await connect();
    initialize.send(type.filters);
    const filters = await initialize.receive(type.breakFilters);
    assert.equal(filters.int(), 0); filters.done();
    const initializedClosed = once(initialize.socket, 'close');
    initialize.send(type.disconnect);
    await initializedClosed;

    const debug = await connect();
    debug.send(type.start, i32(2));
    const version = await debug.receive(type.version);
    assert.equal(version.int(), 1); version.done();
    await debug.stopped('entry');
    assert.equal((await debug.stack())[0].line, lines.init);
    assert.deepEqual(await debug.variables('0:%local%'), []);

    // Two whole requests in one TCP write, including a moved breakpoint.
    debug.socket.write(Buffer.concat([
        packet(type.clear, str(scriptPath), str('Demo')),
        packet(type.breakpoint, str(scriptPath), i32(lines.call - 1), i32(42), str('Demo')),
    ]));
    let bp = await debug.receive(type.breakpoint);
    assert.equal(bp.string(), scriptPath); assert.equal(bp.int(), lines.call); assert.equal(bp.int(), 42); bp.done();
    await debug.run(type.continue, 'breakpoint');
    assert.equal((await debug.evaluate('Counter')).text, '1');
    assert.equal((await debug.stack())[0].module, 'Demo');

    await debug.run(type.into, 'step');
    let stack = await debug.stack();
    assert.deepEqual(stack.map(f => f.name), ['Add', 'Main']);
    assert.equal(stack[0].line, lines.add);
    assert.equal(stack[1].line, lines.call);
    assert.deepEqual((await debug.variables('0:%local%')).map(v => v.name), ['A', 'B']);
    assert.equal((await debug.evaluate('Counter', 1)).text, '1');
    assert.match((await debug.evaluate('Counter', 0)).text, /unavailable/);
    await debug.run(type.over, 'step');
    assert.equal((await debug.evaluate('Result')).text, '3');
    await debug.run(type.out, 'step');
    stack = await debug.stack();
    assert.equal(stack.length, 1); assert.equal(stack[0].line, lines.store);
    assert.equal((await debug.evaluate('Counter')).text, '3');
    await debug.run(type.over, 'step');
    assert.equal((await debug.evaluate('Demo::State.LastResult')).text, '3');
    assert.equal((await debug.variables('0:%module%'))[0].members, true);
    assert.equal((await debug.variables('0:%module%.Demo::State'))[0].text, '3');
    assert.equal((await debug.variables('0:Demo::State'))[0].text, '3');
    assert.deepEqual(await debug.variables('0:%this%'), []);
    assert.match((await debug.evaluate('Counter + 1')).text, /unsupported/);

    await debug.run(type.continue, 'breakpoint'); // next loop: Counter=4
    await debug.run(type.over, 'step'); // skip the Add frame, return to Store
    assert.equal((await debug.stack())[0].line, lines.store);
    assert.equal((await debug.evaluate('Counter')).text, '6');
    debug.send(type.breakpoint, str('Other.as'), i32(1), i32(99), str('Other'));
    bp = await debug.receive(type.breakpoint);
    bp.string(); assert.equal(bp.int(), -1); assert.equal(bp.int(), 99); bp.done();
    debug.send(type.clear, str(scriptPath), str('Demo'));
    debug.send(type.continue);
    await debug.receive(type.continued);
    debug.send(type.pause);
    await debug.stopped('pause');

    // Both FIFO replies must arrive, without a wire request ID.
    debug.socket.write(Buffer.concat([
        packet(type.requestEvaluate, str('Demo::State.LastResult'), i32(0)),
        packet(type.requestEvaluate, str('Demo::State.ExecutedInstructions'), i32(0)),
    ]));
    assert.equal(readValue(await debug.receive(type.evaluate)).name, 'Demo::State.LastResult');
    assert.equal(readValue(await debug.receive(type.evaluate)).name, 'Demo::State.ExecutedInstructions');

    // A bad client must not take down the LSP or debug connections.
    for (const invalid of [i32(0), i32(65537), packet(type.requestEvaluate, i32(100))]) {
        const bad = await connect();
        const closed = once(bad.socket, 'close');
        bad.socket.write(invalid);
        await closed;
    }
    lsp.send(type.filters);
    assert.equal((await lsp.receive(type.breakFilters)).int(), 0);
    const closed = once(debug.socket, 'close');
    debug.socket.write(Buffer.concat([packet(type.stop), packet(type.disconnect)]));
    await closed;
    const again = await connect();
    again.send(type.start, i32(2));
    await again.receive(type.version); await again.stopped('entry');
    assert.equal((await again.stack())[0].line, lines.init);
    console.log('PASS: TCP framing, LSP database, temporary connection, breakpoint mapping, step in/over/out, stack, variables, Watch, pause, reconnect, malformed clients.');
} catch (error) {
    console.error(server.logs());
    throw error;
} finally {
    for (const socket of sockets) socket.destroy();
    await server.close();
}
