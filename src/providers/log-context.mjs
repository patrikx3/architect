import { AsyncLocalStorage } from 'node:async_hooks';

// AsyncLocalStorage so the orchestrator's log() callback reaches the providers
// (and through them, sub-CLI stderr/stdout). Without this, the providers can only
// write to process.stderr, which is invisible to MCP clients that don't surface it.
//
// The store value is { log, buffer } per architect() invocation. subLog() is called
// by both providers with raw chunks; we line-buffer per context, then forward whole
// lines to ctx.log so MCP notifications stay one-line-per-event.
export const logStore = new AsyncLocalStorage();

export function subLog(chunk) {
    const ctx = logStore.getStore();
    if (!ctx) {
        // Outside an architect() run (e.g. someone calling callAnthropic directly).
        process.stderr.write(chunk);
        return;
    }
    ctx.buffer += chunk;
    let nl;
    while ((nl = ctx.buffer.indexOf('\n')) !== -1) {
        const line = ctx.buffer.slice(0, nl).replace(/\r$/, '');
        ctx.buffer = ctx.buffer.slice(nl + 1);
        if (line.length) ctx.log(line);
    }
}

export function subLogFlush() {
    const ctx = logStore.getStore();
    if (!ctx) return;
    if (ctx.buffer.length > 0) {
        ctx.log(ctx.buffer);
        ctx.buffer = '';
    }
}
