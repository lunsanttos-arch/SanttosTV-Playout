"use strict";

const assert = require("node:assert/strict");
const {
    InputPrebufferManager,
    prebufferKey
} = require("../src/core/playout/input-prebuffer");

function makeManager(overrides = {}) {
    const calls = {
        resolve: 0,
        proxy: 0,
        bridge: 0,
        bridgeStops: 0,
        proxyCloses: 0,
        lastBridgeOptions: null
    };

    const manager =
        new InputPrebufferManager({
            resolveRemoteInput:
                overrides.resolveRemoteInput ||
                (async (url) => {
                    calls.resolve += 1;
                    return {
                        provider:
                            "direct",
                        providerId:
                            null,
                        url,
                        userAgent:
                            "QA",
                        referer:
                            "",
                        cookie:
                            ""
                    };
                }),
            createRemoteHlsProxy:
                overrides.createRemoteHlsProxy ||
                (async () => {
                    calls.proxy += 1;
                    return {
                        url:
                            "http://127.0.0.1:19000/live.m3u8",
                        close() {
                            calls.proxyCloses += 1;
                        }
                    };
                }),
            findVlcPath:
                overrides.findVlcPath ||
                (() =>
                    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"),
            selectInputEngine:
                overrides.selectInputEngine ||
                ((preferred, provider, available) => {
                    if (preferred === "vlc") {
                        if (!available) {
                            throw new Error(
                                "VLC ausente"
                            );
                        }
                        return "vlc";
                    }

                    if (preferred === "ffmpeg") {
                        return "ffmpeg";
                    }

                    return provider === "dailymotion" &&
                        available
                        ? "vlc"
                        : "ffmpeg";
                }),
            startVlcInputBridge:
                overrides.startVlcInputBridge ||
                (async (url, options = {}) => {
                    calls.bridge += 1;
                    calls.lastBridgeOptions =
                        options;
                    return {
                        sourceUrl:
                            url,
                        videoUrl:
                            "udp://127.0.0.1:30001",
                        audioUrl:
                            "udp://127.0.0.1:30002",
                        stop() {
                            calls.bridgeStops += 1;
                        }
                    };
                }),
            ttlMs: 10000,
            now:
                overrides.now ||
                (() => 1_000_000)
        });

    return {
        manager,
        calls
    };
}

async function main() {
    assert.match(
        prebufferKey(
            "https://example.com/live.m3u8",
            {
                itemId: "next-1",
                inputEngine: "auto",
                inputProtocol: "hls"
            }
        ),
        /^next-1\|auto\|hls\|/
    );

    {
        const {
            manager,
            calls
        } = makeManager();

        const prepared =
            await manager.prepare(
                "https://example.com/live.m3u8",
                {
                    itemId:
                        "next-hls",
                    inputEngine:
                        "auto",
                    inputProtocol:
                        "hls"
                }
            );

        assert.equal(
            prepared.ready,
            true
        );
        assert.equal(
            prepared.engine,
            "vlc",
            "HLS em Automático deve aquecer VLC quando disponível."
        );
        assert.equal(
            calls.resolve,
            1
        );
        assert.equal(
            calls.bridge,
            1
        );
        assert.equal(
            calls.lastBridgeOptions
                ?.networkCachingMs,
            1400,
            "Pré-carga HLS deve reservar margem de jitter suficiente para evitar microtravadas."
        );

        await manager.prepare(
            "https://example.com/live.m3u8",
            {
                itemId:
                    "next-hls",
                inputEngine:
                    "auto",
                inputProtocol:
                    "hls"
            }
        );

        assert.equal(
            calls.bridge,
            1,
            "Pré-carga idempotente não deve abrir outra ponte."
        );

        const taken =
            manager.take(
                "https://example.com/live.m3u8",
                {
                    itemId:
                        "next-hls",
                    inputEngine:
                        "auto",
                    inputProtocol:
                        "hls"
                }
            );

        assert(
            taken,
            "PLAY deve conseguir assumir a sessão aquecida."
        );
        assert.equal(
            taken.playbackPath,
            "udp://127.0.0.1:30001"
        );
        assert.equal(
            manager.status().ready,
            false
        );

        // Recursos transferidos ao PROGRAM não podem ser fechados pelo take.
        assert.equal(
            calls.bridgeStops,
            0
        );

        taken.vlcBridge.stop();
        assert.equal(
            calls.bridgeStops,
            1
        );
    }

    {
        const {
            manager,
            calls
        } = makeManager();

        const prepared =
            await manager.prepare(
                "https://example.com/live.m3u8",
                {
                    itemId:
                        "forced-ffmpeg",
                    inputEngine:
                        "ffmpeg",
                    inputProtocol:
                        "hls"
                }
            );

        assert.equal(
            prepared.engine,
            "ffmpeg"
        );
        assert.equal(
            calls.bridge,
            0,
            "Motor FFmpeg explícito não pode ser trocado por VLC."
        );

        manager.cancel();
    }

    {
        const {
            manager,
            calls
        } = makeManager({
            resolveRemoteInput:
                async () => ({
                    provider:
                        "dailymotion",
                    providerId:
                        "x9xwtpy",
                    url:
                        "https://fresh.example/master.m3u8",
                    userAgent:
                        "QA",
                    referer:
                        "https://www.dailymotion.com/",
                    cookie:
                        "qa=1"
                })
        });

        await manager.prepare(
            "https://www.dailymotion.com/video/x9xwtpy",
            {
                itemId:
                    "daily",
                inputEngine:
                    "auto",
                inputProtocol:
                    "hls"
            }
        );

        assert.equal(
            calls.proxy,
            1
        );
        assert.equal(
            calls.bridge,
            1
        );

        manager.cancel();

        assert.equal(
            calls.bridgeStops,
            1
        );
        assert.equal(
            calls.proxyCloses,
            1
        );
    }

    {
        let resolveFirst;
        const firstPromise =
            new Promise((resolve) => {
                resolveFirst = resolve;
            });

        let resolverCalls = 0;

        const {
            manager,
            calls
        } = makeManager({
            resolveRemoteInput:
                async (url) => {
                    resolverCalls += 1;

                    if (resolverCalls === 1) {
                        await firstPromise;
                    }

                    return {
                        provider:
                            "direct",
                        providerId:
                            null,
                        url,
                        userAgent:
                            "QA",
                        referer:
                            "",
                        cookie:
                            ""
                    };
                }
        });

        const stalePrepare =
            manager.prepare(
                "https://example.com/old.m3u8",
                {
                    itemId:
                        "old",
                    inputEngine:
                        "auto",
                    inputProtocol:
                        "hls"
                }
            );

        manager.cancel();

        resolveFirst();

        const result =
            await stalePrepare;

        assert.equal(
            result.stale,
            true,
            "Pré-carga obsoleta deve ser descartada sem tomar o PROGRAM."
        );
        assert.equal(
            manager.status().ready,
            false
        );
        assert.equal(
            calls.bridgeStops,
            1,
            "Ponte criada por preparo obsoleto deve ser fechada."
        );
    }

    console.log(
        "INPUT PREBUFFER QA: APROVADO — aquecimento 5s, idempotência, take e cancelamento seguro."
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
