"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PlayoutRecovery } = require("../src/core/playout/playout-recovery");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "santtos-recovery-"));
try {
    let recovery = new PlayoutRecovery(root);
    assert.equal(recovery.state, null);
    recovery.save({ itemId: "second-item", positionSeconds: 17.25, playing: true });

    recovery = new PlayoutRecovery(root);
    assert.equal(recovery.state.itemId, "second-item");
    assert.equal(recovery.state.positionSeconds, 17.25);
    assert.equal(recovery.state.playing, true);

    recovery.captureNative({ itemId: "second-item", positionSeconds: 18.5, state: "PAUSED" });
    assert.equal(new PlayoutRecovery(root).state.playing, false);

    // A damaged primary must use the backup, and the next save must not
    // replace the good backup with that damaged primary.
    fs.writeFileSync(recovery.file, "broken");
    recovery = new PlayoutRecovery(root);
    assert.equal(recovery.state.positionSeconds, 17.25);
    recovery.save({ itemId: "second-item", positionSeconds: 19, playing: false });
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(recovery.file + ".bak", "utf8")));
    assert.throws(() => recovery.save({ itemId: "x", positionSeconds: NaN }));
    assert.equal(new PlayoutRecovery(root).state.positionSeconds, 19);

    recovery.captureNative({ itemId: "second-item", positionSeconds: 20, state: "FAULT" });
    assert.equal(new PlayoutRecovery(root).state.playing, false, "Faults must not auto-restart a broken source");
    console.log("RECOVERY QA: passed restart, pause, corrupt checkpoint fallback and validation");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
