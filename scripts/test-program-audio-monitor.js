"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { NdiAudioSource } = require("../src/core/audio/ndi-audio-source");

function waitFor(predicate, timeoutMs = 5000) {
    const started = Date.now();

    return new Promise((resolve, reject) => {
        const tick = () => {
            try {
                if (predicate()) {
                    resolve();
                    return;
                }
            } catch (error) {
                reject(error);
                return;
            }

            if (Date.now() - started > timeoutMs) {
                reject(new Error("Timeout aguardando PCM real do PROGRAM."));
                return;
            }

            setTimeout(tick, 25);
        };

        tick();
    });
}

async function main() {
    const root =
        fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                "santtos-program-monitor-"
            )
        );

    try {
        const input =
            path.join(
                root,
                "stereo-tone.wav"
            );

        execFileSync(
            ffmpeg,
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=750:sample_rate=48000:duration=0.35",
                "-ac",
                "2",
                "-c:a",
                "pcm_s16le",
                "-y",
                input
            ],
            {
                windowsHide: true,
                timeout: 30000
            }
        );

        let callbackBytes = 0;
        let callbackChunks = 0;
        let callbackRate = 0;
        let callbackChannels = 0;

        const source =
            new NdiAudioSource({
                pipePath: "",
                ffmpegPath: ffmpeg,
                filePath: input,
                streamIndex: null,
                startSeconds: 0,
                durationSeconds: null,
                sampleRate: 48000,
                channels: 2,
                onPcmData(
                    chunk,
                    sampleRate,
                    channels
                ) {
                    callbackBytes +=
                        chunk.length;
                    callbackChunks += 1;
                    callbackRate =
                        sampleRate;
                    callbackChannels =
                        channels;
                }
            }).start();

        await waitFor(
            () =>
                callbackBytes >
                4096
        );

        const snapshot =
            source.snapshot();

        assert.equal(
            snapshot.state,
            "FLOWING",
            "Decoder sem pipe NDI deve continuar entregando PCM ao monitor local."
        );
        assert.equal(
            snapshot.active,
            true,
            "PCM real deve marcar o medidor como ativo."
        );
        assert.equal(
            snapshot.routedToNdi,
            false,
            "Teste local não deve fingir rota NDI."
        );
        assert(
            snapshot.leftDb > -50 &&
            snapshot.rightDb > -50,
            "Medidor real precisa ler os dois canais."
        );
        assert(
            callbackChunks > 0 &&
            callbackBytes > 0,
            "Monitor deve receber chunks PCM reais."
        );
        assert.equal(
            callbackRate,
            48000
        );
        assert.equal(
            callbackChannels,
            2
        );

        source.stop();

        assert.equal(
            source.snapshot().state,
            "IDLE"
        );

        console.log(
            "PROGRAM AUDIO MONITOR QA: APROVADO — PCM real toca/mede sem depender do pipe NDI."
        );
    } finally {
        fs.rmSync(
            root,
            {
                recursive: true,
                force: true
            }
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
