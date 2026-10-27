"use strict";
// One active deck is owned by PROGRAM; this object owns only the next candidate.
class DeckPreparer {
    constructor({ create, key, timeoutMs = 20000 }) { this.create = create; this.key = key; this.timeoutMs = timeoutMs; this.generation = 0; this.candidate = null; this.lastError = null; }
    prepare(item, position, overlay) {
        const key = this.key(item, position, overlay);
        if (this.candidate?.key === key) return this.candidate.promise;
        this.cancel(); const generation = this.generation, controller = new AbortController();
        const candidate = { key, itemId: item.id, controller, deck: null, generation, startedAt: Date.now(), phase: 'source' };
        this.candidate = candidate; this.lastError = null;
        let timer, onAbort;
        const canceled = new Promise((_resolve, reject) => {
            onAbort = () => reject(controller.signal.reason?.name !== 'AbortError' && controller.signal.reason instanceof Error
                ? controller.signal.reason : Error("Deck de outra revisão descartado."));
            controller.signal.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => controller.abort(Object.assign(Error(`Preparo do material excedeu ${this.timeoutMs / 1000} segundos, incluindo acesso à origem.`), { code: 'PREPARATION_TIMEOUT' })), this.timeoutMs);
        });
        const work = Promise.resolve().then(() => this.create(item, position, overlay, controller.signal)).then(async deck => {
            candidate.deck = deck;
            if (generation !== this.generation || controller.signal.aborted) { deck.stop(); throw Error("Deck de outra revisão descartado."); }
            candidate.phase = 'preroll';
            await deck.ready;
            if (generation !== this.generation || controller.signal.aborted) { deck.stop(); throw Error("Deck de outra revisão descartado."); }
            candidate.phase = 'ready';
            return deck;
        });
        candidate.promise = Promise.race([work, canceled]).catch(error => {
            candidate.phase = 'failed';if (this.candidate === candidate) this.lastError = error.message;throw error;
        }).finally(() => { clearTimeout(timer);controller.signal.removeEventListener('abort', onAbort); });
        candidate.promise.catch(() => {}); return candidate.promise;
    }
    async take(item, position, overlay) {
        const hadPreparation = this.candidate?.key === this.key(item, position, overlay);
        const promise = this.prepare(item, position, overlay), candidate = this.candidate;
        try {
            const deck = await promise;
            if (this.candidate !== candidate) throw Error("CUT cancelado por nova programação.");
            if (deck.stopped) throw Error(deck.error || "Decoder preparado encerrou antes do CUT.");
            this.candidate = null; return deck;
        } catch (error) {
            // A speculative failure is not yet an on-air failure. Reopen once at
            // CUT; never reuse its rejected promise/dead decoder or retry a cancel.
            if (!hadPreparation || this.candidate !== candidate ||
                (candidate.controller.signal.aborted && candidate.controller.signal.reason?.code !== 'PREPARATION_TIMEOUT')) throw error;
            this.cancel();
            return this.take(item, position, overlay);
        }
    }
    cancel() {
        ++this.generation;
        const old = this.candidate; this.candidate = null;
        old?.controller.abort(); old?.deck?.stop();
    }
    snapshot() { return { owner: "backend", itemId: this.candidate?.itemId || null, generation: this.generation,
        phase: this.candidate?.phase || null, elapsedMs: this.candidate ? Date.now() - this.candidate.startedAt : null, timeoutMs: this.timeoutMs,
        ...(this.candidate?.deck?.snapshot() || { ready: false }), error: this.lastError }; }
}
module.exports = { DeckPreparer };
