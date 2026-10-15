"use strict";
const assert = require("node:assert/strict");
const { DeckPreparer } = require("../src/core/playout/deck-preparer");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const created = [];
    const manager = new DeckPreparer({ key: (item, position, overlay) => JSON.stringify([item.id, item.path, position, overlay.out]),
        create: async (item, _position, _overlay, signal) => {
            await delay(item.delay || 0);
            const deck = { ready: Promise.resolve(), stopped: false, stop() { this.stopped = true; },
                snapshot() { return { ready: !this.stopped }; } };
            signal.addEventListener("abort", () => deck.stop()); created.push(deck); return deck;
        } });
    const item = { id: "next", path: "file.mp4" };
    const first = manager.prepare(item, 0, { out: 10 });
    assert.equal(first, manager.prepare(item, 0, { out: 10 }), "Identical preparation must reuse one decoder");
    const prepared = await first; assert(manager.snapshot().ready);
    assert.equal(await manager.take(item, 0, { out: 10 }), prepared); assert.equal(created.length, 1);
    manager.cancel(); assert(!prepared.stopped, "Preparing another deck must not stop the taken PROGRAM deck");
    const stale = manager.prepare({ ...item, delay: 30 }, 0, { out: 10 });
    await delay(5); const current = manager.prepare({ ...item, path: "replacement.mp4" }, 0, { out: 10 });
    await assert.rejects(stale, /descartado/); await current; assert(created[1].stopped || created[2].stopped);
    const currentDeck = manager.candidate.deck;
    await manager.prepare({ ...item, path: "replacement.mp4" }, 5, { out: 8 });
    assert(currentDeck.stopped, "Changing IN/OUT must discard old readiness");
    manager.cancel(); assert.equal(manager.snapshot().itemId, null);
    assert(!prepared.stopped); prepared.stop();
    console.log("DECK PREPARER: decoder reuse, ordered take, active isolation, late cancellation, replacement and IN/OUT invalidation passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
