const { flushPersistence, closePersistence } = require("../src/core/persistence/json-store");
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    ServerMediaManager
} = require(
    "../src/core/media/server-media"
);

(async () => {
    const root =
        fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                "santtos-server-media-"
            )
        );

    try {
        const userData =
            path.join(
                root,
                "user-data"
            );
        const serverRoot =
            path.join(
                root,
                "server"
            );

        fs.mkdirSync(
            serverRoot,
            { recursive: true }
        );

        const source =
            path.join(
                serverRoot,
                "vt-teste.mp4"
            );

        fs.writeFileSync(
            source,
            Buffer.alloc(
                1024 * 1024,
                0x55
            )
        );

        const manager =
            new ServerMediaManager();

        manager.initialize(
            userData
        );

        assert.equal(manager.getSettings().enabled, true);
        assert.equal(manager.isServerMediaPath("C:\\Videos\\local.mp4"), false);
        assert.equal(manager.isServerMediaPath("D:\\Videos\\external.mp4"), true);
        assert.equal(manager.isServerMediaPath("\\\\nas\\videos\\network.mp4"), true);

        manager.updateSettings({
            enabled: true,
            rootPath:
                serverRoot,
            cacheEnabled: true,
            cacheMaxGb: 5,
            prefetchNext: true
        });

        assert.equal(
            manager.isServerMediaPath(
                source
            ),
            true
        );

        manager.setRealtimePriority(
            true,
            "input-web-on-air"
        );

        const suspended =
            await manager.prepare(
                source
            );

        assert.equal(
            suspended.state,
            "suspended"
        );
        assert.equal(
            manager.status()
                .prefetchSuspended,
            true
        );

        manager.setRealtimePriority(
            false
        );

        assert.equal(
            manager.status()
                .prefetchSuspended,
            false
        );

        const prepared =
            await manager.prepare(
                source
            );

        assert.equal(
            prepared.state,
            "ready"
        );
        assert.equal(
            prepared.cached,
            true
        );
        assert.notEqual(
            prepared.playbackPath,
            source
        );
        assert(
            fs.existsSync(
                prepared.playbackPath
            )
        );

        const resolved =
            await manager
                .resolveForPlayback(
                    source
                );

        assert.equal(
            resolved.state,
            "cached"
        );
        assert.equal(
            resolved.playbackPath,
            prepared.playbackPath
        );

        fs.rmSync(
            source
        );

        const fallback =
            await manager
                .resolveForPlayback(
                    source
                );

        assert.equal(
            fallback.state,
            "fallback-cache"
        );
        assert.equal(
            fallback.staleFallback,
            true
        );
        assert.equal(
            fallback.playbackPath,
            prepared.playbackPath
        );

        const status =
            manager.status();

        assert.equal(
            status.cachedFiles,
            1
        );
        assert(
            status.cachedBytes >
                0
        );

        await manager.clearCache();

        assert.equal(
            manager.status()
                .cachedFiles,
            0
        );

        for (const [key, cachedAt, lastUsedAt] of [["old", 1, 100], ["new", 2, 1], ["active", 0, 0]]) {
            const cachePath = path.join(manager.cacheFolder, key + ".mp4");
            fs.writeFileSync(cachePath, "test");
            manager.index.set(key, { cachePath, size: 2 * 1024 ** 3, cachedAt, lastUsedAt });
        }
        manager.activeSourcePath = "active";
        await manager.prune();
        assert(!manager.index.has("old"), "Eviction uses creation age even when recently played");
        assert(manager.index.has("new") && manager.index.has("active"), "Newest and on-air copies must survive eviction");

        console.log(
            "SERVER MEDIA QA: APROVADO — cache local, prioridade do Input Web, resolução de playback e fallback sem servidor."
        );
    } finally {
        await closePersistence();
        fs.rmSync(
            root,
            {
                recursive: true,
                force: true
            }
        );
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
