"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const db = require("../src/database/database");
const { closePersistence, flushPersistence } = require("../src/core/persistence/json-store");
const ts = require("typescript");
// Run the real renderer reconciliation against the queue restored from disk.
function refreshLibrary(queue, media) {
    const source = fs.readFileSync(path.join(__dirname, "../src/renderer/src/App.tsx"), "utf8");
    const middle = source.indexOf("const mediaById = new Map(\n            media.map");
    const start = source.lastIndexOf("useEffect(() => {", middle);
    const end = source.indexOf("}, [media]);", middle) + "}, [media]);".length;
    new Function("useEffect", "timelineLoadedRef", "media", "setTimelineQueue",
        "normalizeClipPoint", "normalizeClipOutPoint", "normalizeExhibitionType",
        ts.transpile(source.slice(start, end)))(effect => effect(), { current: true }, media,
            update => { queue = update(queue); }, value => value, value => value, value => value);
    return queue;
}
(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-schedule-only-"));
    try {
        const file = path.join(root, "one-off.mp4"); fs.writeFileSync(file, "fixture");
        db.initializeDatabase({ userDataPath: root });
        const item = db.addMedia([file], true).importedItems[0];
        assert.equal(db.getMedia().length, 0);
        db.updateMediaMetadata(item.id, { duration: 40, status: "compatible", quality: { status: "approved", version: 1 } });
        const updated = db.getPlayableMedia()[0];
        const occurrence = { ...updated, id: "occurrence", sourceMediaId: item.id, rundownItemId: "slot", inPoint: 2, outPoint: 8 };
        db.saveDailyRundown({ date: "2026-10-19", startTime: "06:00", items: [occurrence] });
        db.saveWeeklyRundown(1, { startTime: "06:00", items: [occurrence] });
        db.saveTimeline([occurrence]);
        assert.equal(db.getTimeline()[0].path, file);
        assert.equal(db.getDailyRundown("2026-10-19").items[0].duration, 40);
        assert.equal(db.addMedia([file], true).importedItems.length, 0);
        await flushPersistence(); await closePersistence();
        db.initializeDatabase({ userDataPath: root });
        assert.equal(db.getMedia().length, 0);
        assert.equal(db.getTimeline()[0].outPoint, 8);
        assert.equal(db.getDailyRundown("2026-10-19").items[0].sourceMediaId, item.id);
        assert.equal(db.getWeeklyRundown(1).items[0].path, file);
        assert.equal(db.getPlayableMedia()[0].quality.status, "approved");
        const restored = db.getTimeline();
        assert.equal(restored[0].scheduleOnly, true);
        const reconciled = refreshLibrary(restored, db.getMedia());
        assert.deepEqual(reconciled, restored, "Library refresh must preserve restored one-off files and their clip settings");
        const withOtherEntries = [restored[0], { id: "live", placeholder: true, liveSlot: true },
            { id: "web", sourceType: "input" }, { id: "removed-library", sourceMediaId: "removed-library" }];
        assert.deepEqual(refreshLibrary(withOtherEntries, []), withOtherEntries.slice(0, 3),
            "Preserve one-off/live/web order while honoring explicit library removals");
        db.saveTimeline(reconciled);
        await flushPersistence(); await closePersistence();
        db.initializeDatabase({ userDataPath: root });
        assert.deepEqual(db.getTimeline(), restored, "Autosave after reopening must not erase one-off occurrences");
        // Explicit library import remains possible and independent; deleting it must preserve the rundown file.
        const libraryItem = db.addMedia([file]).importedItems[0];
        assert.notEqual(libraryItem.id, item.id);
        db.removeMedia(libraryItem.id);
        assert.equal(db.getMedia().length, 0);
        assert.equal(db.getTimeline()[0].path, file);
        assert(fs.existsSync(file), "Removing a library entry must not remove one-off originals");
        console.log("Schedule-only files: hidden from library, metadata/QC, daily/weekly/timeline persistence and independent library lifecycle OK.");
    } finally { await closePersistence(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
