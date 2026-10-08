"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    rootPath: "",
    cacheEnabled: true,
    cacheMaxGb: 80,
    prefetchNext: true
});

function normalizedPath(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    let result = path.resolve(trimmed);
    if (process.platform === "win32") {
        result = result.toLowerCase();
    }
    return result.replace(/[\\/]+$/, "");
}

function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

class ServerMediaManager {
    constructor() {
        this.userDataPath = "";
        this.settingsFile = "";
        this.cacheFolder = "";
        this.indexFile = "";
        this.settings = { ...DEFAULT_SETTINGS };
        this.index = new Map();
        this.jobs = new Map();
        this.lastError = "";
        this.lastServerCheckAt = 0;
        this.serverReachable = null;
        this.activeSourcePath = "";
    }

    initialize(userDataPath) {
        this.userDataPath = userDataPath;
        this.settingsFile = path.join(
            userDataPath,
            "server-media.json"
        );
        this.cacheFolder = path.join(
            userDataPath,
            "server-media-cache"
        );
        this.indexFile = path.join(
            this.cacheFolder,
            "index.json"
        );

        fs.mkdirSync(
            this.cacheFolder,
            { recursive: true }
        );

        this.loadSettings();
        this.loadIndex();
        this.cleanupPartials();
    }

    loadSettings() {
        if (!this.settingsFile || !fs.existsSync(this.settingsFile)) {
            this.settings = { ...DEFAULT_SETTINGS };
            this.saveSettings();
            return;
        }

        try {
            const parsed = JSON.parse(
                fs.readFileSync(
                    this.settingsFile,
                    "utf8"
                )
            );
            this.settings = this.normalizeSettings(parsed);
        } catch (error) {
            console.error(
                "Falha ao carregar Server Media:",
                error
            );
            this.settings = { ...DEFAULT_SETTINGS };
        }
    }

    normalizeSettings(value = {}) {
        return {
            enabled: value.enabled === true,
            rootPath:
                typeof value.rootPath === "string"
                    ? value.rootPath.trim().slice(0, 4096)
                    : "",
            cacheEnabled:
                value.cacheEnabled !== false,
            cacheMaxGb:
                Math.round(
                    clampNumber(
                        value.cacheMaxGb,
                        DEFAULT_SETTINGS.cacheMaxGb,
                        5,
                        1000
                    )
                ),
            prefetchNext:
                value.prefetchNext !== false
        };
    }

    saveSettings() {
        if (!this.settingsFile) return;

        fs.mkdirSync(
            path.dirname(this.settingsFile),
            { recursive: true }
        );

        const tmp =
            this.settingsFile +
            "." +
            process.pid +
            "." +
            crypto.randomUUID() +
            ".tmp";

        fs.writeFileSync(
            tmp,
            JSON.stringify(
                this.settings,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            tmp,
            this.settingsFile
        );
    }

    updateSettings(value) {
        this.settings =
            this.normalizeSettings(value);
        this.saveSettings();
        return this.getSettings();
    }

    getSettings() {
        return {
            ...this.settings,
            cacheFolder:
                this.cacheFolder
        };
    }

    loadIndex() {
        this.index.clear();

        if (!fs.existsSync(this.indexFile)) {
            return;
        }

        try {
            const parsed = JSON.parse(
                fs.readFileSync(
                    this.indexFile,
                    "utf8"
                )
            );

            for (const entry of parsed.entries ?? []) {
                if (
                    !entry ||
                    typeof entry.sourcePath !== "string" ||
                    typeof entry.cachePath !== "string"
                ) {
                    continue;
                }

                this.index.set(
                    normalizedPath(entry.sourcePath),
                    {
                        ...entry
                    }
                );
            }
        } catch (error) {
            console.warn(
                "Índice do cache Server Media inválido; reconstrução gradual:",
                error
            );
        }
    }

    saveIndex() {
        if (!this.indexFile) return;

        const tmp =
            this.indexFile +
            "." +
            process.pid +
            ".tmp";

        fs.writeFileSync(
            tmp,
            JSON.stringify(
                {
                    version: 1,
                    entries:
                        Array.from(
                            this.index.values()
                        )
                },
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            tmp,
            this.indexFile
        );
    }

    cleanupPartials() {
        try {
            for (
                const name
                of fs.readdirSync(
                    this.cacheFolder
                )
            ) {
                if (
                    name.endsWith(
                        ".partial"
                    )
                ) {
                    fs.rmSync(
                        path.join(
                            this.cacheFolder,
                            name
                        ),
                        { force: true }
                    );
                }
            }
        } catch {
            // Cache será recriado conforme necessário.
        }
    }

    isServerMediaPath(filePath) {
        if (
            !this.settings.enabled ||
            typeof filePath !== "string" ||
            !filePath.trim()
        ) {
            return false;
        }

        const source =
            normalizedPath(filePath);
        const root =
            normalizedPath(
                this.settings.rootPath
            );

        if (root) {
            return (
                source === root ||
                source.startsWith(
                    root + path.sep
                )
            );
        }

        // Sem raiz explícita, ainda reconhece UNC para facilitar a implantação.
        return /^\\\\/.test(
            filePath.trim()
        );
    }

    cacheKey(filePath) {
        return crypto
            .createHash("sha256")
            .update(
                normalizedPath(filePath)
            )
            .digest("hex");
    }

    cachePathFor(filePath) {
        const extension =
            path
                .extname(filePath)
                .toLowerCase()
                .slice(0, 12);

        return path.join(
            this.cacheFolder,
            this.cacheKey(filePath) +
                extension
        );
    }

    entryFor(filePath) {
        return this.index.get(
            normalizedPath(filePath)
        ) ?? null;
    }

    cachedFileAvailable(filePath) {
        const entry =
            this.entryFor(filePath);

        if (!entry) return null;

        try {
            const stat =
                fs.statSync(
                    entry.cachePath
                );

            if (
                !stat.isFile() ||
                stat.size !== entry.size
            ) {
                return null;
            }

            return entry;
        } catch {
            return null;
        }
    }

    async statSource(
        filePath,
        timeoutMs = 4000
    ) {
        let timer = null;

        try {
            const statPromise =
                fs.promises.stat(
                    filePath
                );

            const timeoutPromise =
                new Promise(
                    (_resolve, reject) => {
                        timer =
                            setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            "Tempo limite ao acessar o servidor."
                                        )
                                    ),
                                timeoutMs
                            );
                    }
                );

            const stat =
                await Promise.race([
                    statPromise,
                    timeoutPromise
                ]);

            if (!stat.isFile()) {
                throw new Error(
                    "O material do servidor não é um arquivo."
                );
            }

            this.serverReachable = true;
            this.lastServerCheckAt = Date.now();
            this.lastError = "";
            return stat;
        } catch (error) {
            this.serverReachable = false;
            this.lastServerCheckAt = Date.now();
            this.lastError =
                error instanceof Error
                    ? error.message
                    : String(error);
            throw error;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    async probeRoot() {
        if (
            !this.settings.enabled ||
            !this.settings.rootPath
        ) {
            this.serverReachable =
                null;
            this.lastError = "";

            return this.status();
        }

        let timer = null;

        try {
            const statPromise =
                fs.promises.stat(
                    this.settings.rootPath
                );

            const timeoutPromise =
                new Promise(
                    (_resolve, reject) => {
                        timer =
                            setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            "Tempo limite ao testar a raiz do servidor."
                                        )
                                    ),
                                4000
                            );
                    }
                );

            const stat =
                await Promise.race([
                    statPromise,
                    timeoutPromise
                ]);

            if (!stat.isDirectory()) {
                throw new Error(
                    "A raiz configurada não é uma pasta."
                );
            }

            this.serverReachable =
                true;
            this.lastServerCheckAt =
                Date.now();
            this.lastError = "";
        } catch (error) {
            this.serverReachable =
                false;
            this.lastServerCheckAt =
                Date.now();
            this.lastError =
                error instanceof Error
                    ? error.message
                    : String(error);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }

        return this.status();
    }

    markActive(filePath) {
        this.activeSourcePath =
            this.isServerMediaPath(
                filePath
            )
                ? normalizedPath(
                      filePath
                  )
                : "";
    }

    clearActive() {
        this.activeSourcePath = "";
    }

    cacheMatches(entry, stat) {
        return Boolean(
            entry &&
            fs.existsSync(entry.cachePath) &&
            Number(entry.size) ===
                Number(stat.size) &&
            Math.abs(
                Number(entry.mtimeMs) -
                Number(stat.mtimeMs)
            ) < 2
        );
    }

    async prepare(filePath) {
        if (!this.isServerMediaPath(filePath)) {
            return {
                applicable: false,
                state: "local",
                sourcePath: filePath,
                playbackPath: filePath
            };
        }

        if (
            !this.settings.cacheEnabled ||
            !this.settings.prefetchNext
        ) {
            return {
                applicable: true,
                state:
                    this.settings.cacheEnabled
                        ? "prefetch-disabled"
                        : "direct",
                sourcePath: filePath,
                playbackPath: filePath
            };
        }

        const key =
            normalizedPath(filePath);
        const running =
            this.jobs.get(key);

        if (running) {
            return running;
        }

        const job =
            this.prepareInternal(
                filePath
            ).finally(() => {
                this.jobs.delete(key);
            });

        this.jobs.set(
            key,
            job
        );

        return job;
    }

    async prepareInternal(filePath) {
        const stat =
            await this.statSource(
                filePath
            );
        const existing =
            this.entryFor(filePath);

        if (
            this.cacheMatches(
                existing,
                stat
            )
        ) {
            existing.lastUsedAt =
                Date.now();
            this.index.set(
                normalizedPath(filePath),
                existing
            );
            this.saveIndex();

            return {
                applicable: true,
                state: "ready",
                sourcePath: filePath,
                playbackPath:
                    existing.cachePath,
                cachePath:
                    existing.cachePath,
                cached: true,
                bytes: stat.size
            };
        }

        const cachePath =
            this.cachePathFor(
                filePath
            );
        const partialPath =
            cachePath +
            "." +
            process.pid +
            ".partial";

        await fs.promises.rm(
            partialPath,
            { force: true }
        );

        try {
            await pipeline(
                fs.createReadStream(
                    filePath,
                    {
                        highWaterMark:
                            4 * 1024 * 1024
                    }
                ),
                fs.createWriteStream(
                    partialPath,
                    {
                        flags: "wx",
                        highWaterMark:
                            4 * 1024 * 1024
                    }
                )
            );

            const copied =
                await fs.promises.stat(
                    partialPath
                );

            if (
                copied.size !==
                stat.size
            ) {
                throw new Error(
                    "Cópia do servidor terminou com tamanho diferente do original."
                );
            }

            await fs.promises.rm(
                cachePath,
                { force: true }
            );
            await fs.promises.rename(
                partialPath,
                cachePath
            );

            const entry = {
                sourcePath:
                    filePath,
                cachePath,
                size:
                    stat.size,
                mtimeMs:
                    stat.mtimeMs,
                cachedAt:
                    Date.now(),
                lastUsedAt:
                    Date.now()
            };

            this.index.set(
                normalizedPath(filePath),
                entry
            );
            this.saveIndex();

            await this.prune();

            return {
                applicable: true,
                state: "ready",
                sourcePath: filePath,
                playbackPath:
                    cachePath,
                cachePath,
                cached: true,
                bytes: stat.size
            };
        } catch (error) {
            await fs.promises.rm(
                partialPath,
                { force: true }
            ).catch(() => {});
            throw error;
        }
    }

    async resolveForPlayback(filePath) {
        if (!this.isServerMediaPath(filePath)) {
            return {
                applicable: false,
                state: "local",
                sourcePath: filePath,
                playbackPath: filePath,
                cached: false,
                staleFallback: false
            };
        }

        const cached =
            this.cachedFileAvailable(
                filePath
            );

        try {
            const stat =
                await this.statSource(
                    filePath
                );

            if (
                this.settings.cacheEnabled &&
                this.cacheMatches(
                    cached,
                    stat
                )
            ) {
                cached.lastUsedAt =
                    Date.now();
                this.saveIndex();

                return {
                    applicable: true,
                    state: "cached",
                    sourcePath: filePath,
                    playbackPath:
                        cached.cachePath,
                    cached: true,
                    staleFallback: false
                };
            }

            if (
                this.settings.cacheEnabled &&
                !this.jobs.has(
                    normalizedPath(filePath)
                )
            ) {
                void this.prepare(
                    filePath
                ).catch(
                    (error) =>
                        console.warn(
                            "Pré-cache Server Media falhou:",
                            error
                        )
                );
            }

            return {
                applicable: true,
                state: "direct",
                sourcePath: filePath,
                playbackPath: filePath,
                cached: false,
                staleFallback: false
            };
        } catch (error) {
            if (cached) {
                cached.lastUsedAt =
                    Date.now();
                this.saveIndex();

                console.warn(
                    "Servidor indisponível; executando cópia local em cache:",
                    filePath
                );

                return {
                    applicable: true,
                    state: "fallback-cache",
                    sourcePath: filePath,
                    playbackPath:
                        cached.cachePath,
                    cached: true,
                    staleFallback: true,
                    warning:
                        "Servidor indisponível; usando última cópia em cache."
                };
            }

            throw new Error(
                "Material do servidor indisponível e sem cópia local em cache: " +
                (
                    error instanceof Error
                        ? error.message
                        : String(error)
                )
            );
        }
    }

    async prune() {
        const maxBytes =
            this.settings.cacheMaxGb *
            1024 *
            1024 *
            1024;

        const entries =
            Array.from(
                this.index.entries()
            )
                .map(([key, entry]) => ({
                    key,
                    entry
                }))
                .filter(({ entry }) =>
                    fs.existsSync(
                        entry.cachePath
                    )
                )
                .sort(
                    (a, b) =>
                        Number(
                            a.entry.lastUsedAt ?? 0
                        ) -
                        Number(
                            b.entry.lastUsedAt ?? 0
                        )
                );

        let total =
            entries.reduce(
                (sum, item) =>
                    sum +
                    Number(
                        item.entry.size ?? 0
                    ),
                0
            );

        for (const item of entries) {
            if (total <= maxBytes) {
                break;
            }

            if (
                this.jobs.has(
                    item.key
                ) ||
                item.key ===
                    this.activeSourcePath
            ) {
                continue;
            }

            try {
                await fs.promises.rm(
                    item.entry.cachePath,
                    { force: true }
                );
                total -=
                    Number(
                        item.entry.size ?? 0
                    );
                this.index.delete(
                    item.key
                );
            } catch (error) {
                console.warn(
                    "Não foi possível liberar item do cache Server Media:",
                    error
                );
            }
        }

        this.saveIndex();
    }

    async clearCache() {
        if (this.jobs.size > 0) {
            throw new Error(
                "Aguarde a pré-carga em andamento antes de limpar o cache."
            );
        }

        for (
            const entry
            of this.index.values()
        ) {
            await fs.promises.rm(
                entry.cachePath,
                { force: true }
            ).catch(() => {});
        }

        this.index.clear();
        this.saveIndex();
        return this.status();
    }

    status() {
        let bytes = 0;
        let files = 0;

        for (
            const entry
            of this.index.values()
        ) {
            if (
                fs.existsSync(
                    entry.cachePath
                )
            ) {
                bytes +=
                    Number(
                        entry.size ?? 0
                    );
                files += 1;
            }
        }

        return {
            enabled:
                this.settings.enabled,
            rootPath:
                this.settings.rootPath,
            cacheEnabled:
                this.settings.cacheEnabled,
            cacheMaxGb:
                this.settings.cacheMaxGb,
            prefetchNext:
                this.settings.prefetchNext,
            cacheFolder:
                this.cacheFolder,
            cachedFiles:
                files,
            cachedBytes:
                bytes,
            activeJobs:
                this.jobs.size,
            activeServerMedia:
                Boolean(
                    this.activeSourcePath
                ),
            serverReachable:
                this.serverReachable,
            lastServerCheckAt:
                this.lastServerCheckAt,
            error:
                this.lastError ||
                null
        };
    }
}

module.exports = {
    ServerMediaManager,
    DEFAULT_SETTINGS
};
