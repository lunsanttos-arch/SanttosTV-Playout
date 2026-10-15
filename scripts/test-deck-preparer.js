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
    let attempts = 0;
    const transient = new DeckPreparer({ key: item => item.id, create: async () => {
        attempts++;
        if (attempts === 1) throw Error("Temporary HLS outage during preparation");
        return { ready: Promise.resolve(), stopped: false, stop() { this.stopped = true; }, snapshot() { return {}; } };
    } });
    await assert.rejects(transient.prepare(item, 0, {}), /Temporary HLS/);
    const recovered = await transient.take(item, 0, {});
    assert.equal(attempts, 2, "A failed preroll must be retried at CUT before skipping the input");
    recovered.stop();
    const expired = await transient.prepare(item, 0, {});
    expired.error = "Prepared decoder died"; expired.stop();
    const replacement = await transient.take(item, 0, {});
    assert.notEqual(replacement, expired, "A decoder that dies after readiness must be reopened"); replacement.stop();
    let failures = 0;
    const permanent = new DeckPreparer({ key: item => item.id, create: async () => { failures++; throw Error("Permanent outage"); } });
    await assert.rejects(permanent.prepare(item, 0, {}));
    await assert.rejects(permanent.take(item, 0, {}), /Permanent outage/);
    assert.equal(failures, 2, "An unavailable source gets only one new attempt at CUT");
    let resolvePending;
    const late = new DeckPreparer({ key: item => item.id, create: () => new Promise(resolve => { resolvePending = resolve; }) });
    const pending = late.take(item, 0, {}); await delay(0); late.cancel();
    resolvePending({ ready: Promise.resolve(), stop() {}, snapshot() { return {}; } });
    await assert.rejects(pending, /descartado/);
    console.log("DECK PREPARER: decoder reuse, ordered take, active isolation, late cancellation, replacement, IN/OUT invalidation, failed/dead preroll retry and bounded permanent-failure handling passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
