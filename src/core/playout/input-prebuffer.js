"use strict";

const {
    isHlsInput,
    isRemoteInputUrl
} = require("./remote-input");

function normalizeEngine(value) {
    const normalized =
        String(value ?? "")
            .trim()
            .toLowerCase();

    return ["auto", "ffmpeg", "vlc"].includes(
        normalized
    )
        ? normalized
        : "auto";
}

function prebufferKey(
    filePath,
    overlayState = {}
) {
    const itemId =
        typeof overlayState.itemId === "string"
            ? overlayState.itemId
            : "";

    return [
        itemId || filePath,
        normalizeEngine(
            overlayState.inputEngine
        ),
        String(
            overlayState.inputProtocol ?? ""
        ).toLowerCase(),
        String(
            overlayState.inputHttpReferer ?? ""
        ),
        String(
            overlayState.inputHttpUserAgent ?? ""
        )
    ].join("|");
}

class InputPrebufferManager {
    constructor({
        resolveRemoteInput,
        createRemoteHlsProxy,
        findVlcPath,
        selectInputEngine,
        startVlcInputBridge,
        startWarmTuner,
        ttlMs = 20000,
        now = Date.now
    }) {
        this.resolveRemoteInput =
            resolveRemoteInput;
        this.createRemoteHlsProxy =
            createRemoteHlsProxy;
        this.findVlcPath =
            findVlcPath;
        this.selectInputEngine =
            selectInputEngine;
        this.startVlcInputBridge =
            startVlcInputBridge;
        this.startWarmTuner = startWarmTuner;
        this.controller = null;
        this.ttlMs =
            Math.max(
                5000,
                Number(ttlMs) ||
                20000
            );
        this.now = now;
        this.session = null;
        this.generation = 0;
        this.timer = null;
    }

    closeSession(
        session = this.session
    ) {
        if (!session) return;

        try {
            session.tuner?.stop?.();
            session.vlcBridge?.stop?.();
        } catch {
            // Processo já encerrado.
        }

        try {
            session.proxy?.close?.();
        } catch {
            // Proxy já encerrado.
        }

        if (this.session === session) {
            this.session = null;
        }
    }

    cancel() {
        this.generation += 1;
        this.controller?.abort();
        this.controller = null;

        if (this.timer) {
            clearTimeout(
                this.timer
            );
            this.timer = null;
        }

        this.closeSession();
    }

    status() {
        if (!this.session || !this.session.tuner?.isAlive()) {
            return {
                ready: false,
                key: null,
                itemId: null,
                engine: null,
                warmedAtMs: null,
                expiresAtMs: null,
                error: null
            };
        }

        return {
            ready: true,
            hasVideo: this.session.tuner.hasVideo,
            hasAudio: this.session.tuner.hasAudio,
            key:
                this.session.key,
            itemId:
                this.session.itemId,
            engine:
                this.session.engine,
            warmedAtMs:
                this.session.warmedAtMs,
            expiresAtMs:
                this.session.expiresAtMs,
            error: null
        };
    }

    async prepare(
        filePath,
        overlayState = {}
    ) {
        if (
            !isRemoteInputUrl(
                filePath
            )
        ) {
            throw new Error(
                "Pré-carga aceita apenas Inputs remotos."
            );
        }

        const key =
            prebufferKey(
                filePath,
                overlayState
            );

        if (
            this.session &&
            this.session.key === key &&
            this.session.tuner?.isAlive() &&
            this.session.expiresAtMs >
                this.now()
        ) {
            return this.status();
        }

        this.cancel();

        const generation =
            this.generation;
        const controller = new AbortController();
        this.controller = controller;

        const resolved =
            await this.resolveRemoteInput(
                filePath,
                {
                    userAgent:
                        overlayState.inputHttpUserAgent,
                    referer:
                        overlayState.inputHttpReferer
                }
            );

        let proxy = null;
        let vlcBridge = null;
        let tuner = null;

        try {
            let sourceUrl =
                resolved.url;

            if (
                resolved.provider ===
                "dailymotion"
            ) {
                proxy =
                    await this.createRemoteHlsProxy(
                        resolved
                    );

                sourceUrl =
                    proxy.url;
            }

            const vlcPath =
                this.findVlcPath();

            let engine =
                this.selectInputEngine(
                    overlayState.inputEngine,
                    resolved.provider,
                    Boolean(vlcPath)
                );

            const preferred =
                normalizeEngine(
                    overlayState.inputEngine
                );

            // Para HLS, o VLC já aberto alguns segundos antes funciona como
            // verdadeiro "tuner quente": na troca, o PROGRAM só conecta ao
            // MPEG-TS local em vez de iniciar handshake/manifests do zero.
            if (
                preferred === "auto" &&
                vlcPath &&
                isHlsInput(
                    resolved.url,
                    overlayState.inputProtocol
                )
            ) {
                engine = "vlc";
            }

            if (engine === "vlc") {
                vlcBridge =
                    await this.startVlcInputBridge(
                        sourceUrl,
                        {
                            vlcPath,
                            userAgent:
                                resolved.provider ===
                                "dailymotion"
                                    ? ""
                                    : resolved.userAgent,
                            referer:
                                resolved.provider ===
                                "dailymotion"
                                    ? ""
                                    : resolved.referer,
                            withAudioCopy:
                                true,
                            networkCachingMs:
                                900
                        }
                    );
            }

            if (generation !== this.generation) throw new Error("Pré-carga cancelada.");
            tuner = await this.startWarmTuner(vlcBridge?.videoUrl || sourceUrl, {
                userAgent: proxy || vlcBridge ? "" : resolved.userAgent,
                referer: proxy || vlcBridge ? "" : resolved.referer,
                cookie: proxy || vlcBridge ? "" : resolved.cookie,
                signal: controller.signal
            });
            if (!tuner.ready || !tuner.hasVideo || !tuner.isAlive()) {
                throw new Error("O tuner não confirmou vídeo decodificado para a pré-carga.");
            }

            if (
                generation !==
                this.generation
            ) {
                tuner.stop();
                try {
                    vlcBridge?.stop?.();
                } catch {
                    // Obsoleto.
                }

                try {
                    proxy?.close?.();
                } catch {
                    // Obsoleto.
                }

                return {
                    ready: false,
                    stale: true
                };
            }

            const warmedAtMs =
                this.now();
            const expiresAtMs =
                warmedAtMs +
                this.ttlMs;

            this.session = {
                key,
                itemId:
                    typeof overlayState.itemId === "string"
                        ? overlayState.itemId
                        : null,
                filePath,
                resolved,
                proxy,
                vlcBridge,
                tuner,
                engine,
                playbackPath:
                    tuner.url,
                audioPlaybackPath:
                    tuner.url,
                warmedAtMs,
                expiresAtMs
            };

            this.timer =
                setTimeout(
                    () => {
                        if (
                            this.session?.key ===
                            key
                        ) {
                            this.closeSession(
                                this.session
                            );
                        }

                        this.timer = null;
                    },
                    this.ttlMs
                );

            return this.status();
        } catch (error) {
            tuner?.stop?.();
            try {
                vlcBridge?.stop?.();
            } catch {
                // Ignora cleanup.
            }

            try {
                proxy?.close?.();
            } catch {
                // Ignora cleanup.
            }

            if (generation !== this.generation) return { ready: false, stale: true };
            throw error;
        }
    }

    take(
        filePath,
        overlayState = {}
    ) {
        if (!this.session) {
            return null;
        }

        const key =
            prebufferKey(
                filePath,
                overlayState
            );

        if (
            this.session.key !== key ||
            !this.session.tuner?.isAlive() ||
            this.session.expiresAtMs <=
                this.now()
        ) {
            if (
                !this.session.tuner?.isAlive() || this.session.expiresAtMs <=
                this.now()
            ) {
                this.cancel();
            }

            return null;
        }

        if (this.timer) {
            clearTimeout(
                this.timer
            );
            this.timer = null;
        }

        const session =
            this.session;

        this.controller = null;
        this.session = null;
        this.generation += 1;

        return session;
    }
}

module.exports = {
    InputPrebufferManager,
    normalizeEngine,
    prebufferKey
};
