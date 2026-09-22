import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const scriptPath = fileURLToPath(new URL('../Script/Demo.as', import.meta.url));
export const scriptRoot = fileURLToPath(new URL('../Script/', import.meta.url));
const source = await readFile(scriptPath, 'utf8');
export const lines = Object.fromEntries(source.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/\/\/ @demo:(\w+)/);
    return match ? [[match[1], index + 1]] : [];
}));

export class Inbox {
    values = [];
    waiters = [];
    error;
    push(value) {
        const index = this.waiters.findIndex(w => w.predicate(value));
        if (index < 0) this.values.push(value);
        else this.waiters.splice(index, 1)[0].resolve(value);
    }
    fail(error) {
        this.error ??= error;
        for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    }
    next(predicate, label = 'message', timeout = 5000) {
        const index = this.values.findIndex(predicate);
        if (index >= 0) return Promise.resolve(this.values.splice(index, 1)[0]);
        if (this.error) return Promise.reject(this.error);
        return new Promise((resolve, reject) => {
            const waiter = { predicate,
                resolve: value => { clearTimeout(timer); resolve(value); },
                reject: error => { clearTimeout(timer); reject(error); },
            };
            const timer = setTimeout(() => {
                this.waiters = this.waiters.filter(w => w !== waiter);
                reject(new Error(`Timed out waiting for ${label}`));
            }, timeout);
            this.waiters.push(waiter);
        });
    }
}

export async function stopProcess(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
}

export async function startServer(executable) {
    assert.ok(executable, 'Usage: node tests/<test>.mjs <path/to/as-debug-server.exe>');
    const child = spawn(executable, ['--port', '0', '--tick-ms', '20', '--script', scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ready = new Inbox();
    let logs = '';
    let readySent = false;
    const capture = chunk => { logs = (logs + chunk).slice(-100000); };
    child.stdout.on('data', chunk => {
        capture(chunk);
        const match = logs.match(/LISTENING 127\.0\.0\.1:(\d+)/);
        if (match && !readySent) {
            readySent = true;
            ready.push(Number(match[1]));
        }
    });
    child.stderr.on('data', capture);
    child.on('error', error => ready.fail(error));
    child.on('exit', code => ready.fail(new Error(`Server exited (${code})\n${logs}`)));
    try {
        const port = await ready.next(() => true, 'server startup');
        return { port, logs: () => logs, close: () => stopProcess(child) };
    } catch (error) {
        await stopProcess(child);
        throw error;
    }
}

// Standard Content-Length transport, used to test the REAL DAP adapter over stdio.
export class DapClient {
    inbox = new Inbox();
    sequence = 1;
    pending = Buffer.alloc(0);
    constructor(child) {
        this.child = child;
        child.stdout.on('data', chunk => {
            try {
                this.pending = Buffer.concat([this.pending, chunk]);
                while (true) {
                    const end = this.pending.indexOf('\r\n\r\n');
                    if (end < 0) break;
                    const match = this.pending.subarray(0, end).toString().match(/Content-Length:\s*(\d+)/i);
                    assert.ok(match, 'Expected DAP Content-Length header');
                    const length = Number(match[1]);
                    if (this.pending.length < end + 4 + length) break;
                    this.inbox.push(JSON.parse(this.pending.subarray(end + 4, end + 4 + length).toString()));
                    this.pending = this.pending.subarray(end + 4 + length);
                }
            } catch (error) { this.inbox.fail(error); }
        });
        child.on('error', error => this.inbox.fail(error));
        child.on('exit', code => this.inbox.fail(new Error(`DAP host exited (${code})`)));
    }
    async request(command, args = {}) {
        const seq = this.sequence++;
        const result = this.inbox.next(m => m.type === 'response' && m.request_seq === seq, command);
        const body = Buffer.from(JSON.stringify({ seq, type: 'request', command, arguments: args }));
        this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
        const response = await result;
        assert.equal(response.success, true, JSON.stringify(response));
        return response.body;
    }
    event(name) { return this.inbox.next(m => m.type === 'event' && m.event === name, name); }
}
