import WebSocket from 'ws'

// Must be the very first local import evaluated anywhere in the app (see
// index.ts, which imports this before everything else). nostr-tools' root
// entry point ('nostr-tools', as opposed to 'nostr-tools/pool') reads
// globalThis.WebSocket once at module-require time and caches it internally
// with no setter — so this has to run before that module is required
// transitively by ANY other import (discovery.ts / reviewsSync.ts, pulled in
// via cron.ts). Setting it later, e.g. inside nostrService.ts or inside the
// discovery/reviewsSync functions themselves, is too late once cron.ts has
// already been imported first.
//
// This must be unconditional, not `if (!globalThis.WebSocket)`: Node 22's
// native (undici) WebSocket implementation has a bug where a failed relay
// connection recurses through its close/error handling and crashes the
// process with "RangeError: Maximum call stack size exceeded". The 'ws'
// package does not have this bug. The old guard was written when the
// Dockerfile targeted node:20-alpine (no native WebSocket, so the guard was
// always true); it silently stopped firing once the image moved to
// node:22-alpine, leaving the buggy native implementation in place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).WebSocket = WebSocket
