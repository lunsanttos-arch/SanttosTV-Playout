import { useEffect, useRef, useState } from "react";

export interface NativeAudioStatus {
    state: "IDLE" | "STARTING" | "FLOWING" | "ENDED" | "ERROR" |
        "NO_TRACK" | "REBUILD_REQUIRED" | "PIPE_NOT_READY";
    error?: string | null;
    active?: boolean;
    leftDb?: number;
    rightDb?: number;
    peakLeftDb?: number;
    peakRightDb?: number;
    sampleRate?: number;
    channels?: number;
    bytesSent?: number;
    connected?: boolean;
    routedToNdi?: boolean;
    nativeActive?: boolean;
    receiverVerified?: boolean;
}

interface Props {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    mediaUrl: string | null;
    isPlaying: boolean;
    nativeOutput: boolean;
    audio: NativeAudioStatus;
}

type StereoValues = {
    l: number;
    r: number;
    pl: number;
    pr: number;
};

type ProgramPcmPayload = {
    sequence: number;
    sampleRate: number;
    channels: number;
    data: Uint8Array | ArrayBuffer;
};

type MonitorEngine = {
    ctx: AudioContext;
    gain: GainNode;
    nextStart: number;
    sequence: number;
    sources: Set<AudioBufferSourceNode>;
};

const SILENT: StereoValues = { l: -60, r: -60, pl: -60, pr: -60 };

function db(value: number) {
    return Math.max(-60, Math.min(3, Number.isFinite(value) ? value : -60));
}

function percent(value: number) {
    return Math.round(Math.max(0, Math.min(100, ((db(value) + 60) / 60) * 100)));
}

function payloadBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
    return data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
}

function floatSamples(data: Uint8Array | ArrayBuffer): Float32Array {
    const bytes = payloadBytes(data);
    const usableBytes =
        bytes.byteLength -
        (bytes.byteLength % 4);

    if (usableBytes <= 0) {
        return new Float32Array(0);
    }

    // IPC may deliver a view with a non-4-byte-aligned byteOffset.
    // Copying also prevents the audio scheduler from retaining a large
    // serialization backing buffer after this chunk has been queued.
    const aligned =
        new Uint8Array(usableBytes);
    aligned.set(
        bytes.subarray(
            0,
            usableBytes
        )
    );

    return new Float32Array(
        aligned.buffer
    );
}

export default function ProgramAudioMeters({
    videoRef, mediaUrl, isPlaying, nativeOutput, audio
}: Props) {
    const [preview, setPreview] = useState<StereoValues>(SILENT);
    const [previewError, setPreviewError] = useState("");
    const [previewSuspended, setPreviewSuspended] = useState(false);
    const [monitorSuspended, setMonitorSuspended] = useState(false);
    const [monitorError, setMonitorError] = useState("");
    const [monitorEnabled, setMonitorEnabled] = useState(() =>
        window.localStorage.getItem("santtos-program-audio-monitor") !== "off"
    );

    const monitorEnabledRef = useRef(monitorEnabled);
    const isPlayingRef = useRef(isPlaying);
    const monitor = useRef<MonitorEngine | null>(null);

    const graph = useRef<{
        element: HTMLVideoElement;
        ctx: AudioContext;
        left: AnalyserNode;
        right: AnalyserNode;
        bufferL: Float32Array<ArrayBuffer>;
        bufferR: Float32Array<ArrayBuffer>;
        peakL: number;
        peakR: number;
    } | null>(null);

    function resetRealMonitor() {
        const current =
            monitor.current;

        if (!current) return;

        for (
            const source of
            current.sources
        ) {
            try {
                source.stop();
            } catch {
                // O bloco pode já ter terminado.
            }

            try {
                source.disconnect();
            } catch {
                // Já desconectado.
            }
        }

        current.sources.clear();
        current.nextStart = 0;
    }

    function ensureRealMonitor(): MonitorEngine | null {
        if (monitor.current) {
            return monitor.current;
        }

        try {
            const ctx =
                new AudioContext({
                    latencyHint:
                        "interactive"
                });
            const gain =
                ctx.createGain();

            gain.gain.value =
                monitorEnabledRef.current
                    ? 1
                    : 0;
            gain.connect(
                ctx.destination
            );

            const engine: MonitorEngine = {
                ctx,
                gain,
                nextStart: 0,
                sequence: -1,
                sources:
                    new Set()
            };

            ctx.onstatechange = () => {
                setMonitorSuspended(
                    ctx.state === "suspended"
                );
            };

            monitor.current =
                engine;
            setMonitorSuspended(
                ctx.state === "suspended"
            );
            setMonitorError("");

            void ctx.resume()
                .then(() =>
                    setMonitorSuspended(
                        ctx.state ===
                            "suspended"
                    )
                )
                .catch((error) => {
                    setMonitorSuspended(true);
                    setMonitorError(
                        "Clique em ATIVAR SOM."
                    );
                    console.warn(
                        "Monitor PCM suspenso:",
                        error
                    );
                });

            return engine;
        } catch (error) {
            setMonitorError(
                "Saída local de áudio indisponível."
            );
            console.error(
                "Falha ao abrir monitor PCM:",
                error
            );
            return null;
        }
    }

    function queueRealPcm(
        payload: ProgramPcmPayload
    ) {
        if (
            !monitorEnabledRef.current ||
            !isPlayingRef.current
        ) {
            return;
        }

        const channels =
            Number(payload.channels) === 1
                ? 1
                : 2;
        const sampleRate =
            [44100, 48000].includes(
                Number(
                    payload.sampleRate
                )
            )
                ? Number(
                      payload.sampleRate
                  )
                : 48000;
        const samples =
            floatSamples(
                payload.data
            );
        const frames =
            Math.floor(
                samples.length /
                channels
            );

        if (frames <= 0) return;

        const engine =
            ensureRealMonitor();

        if (!engine) return;

        if (
            engine.sequence !==
            payload.sequence
        ) {
            resetRealMonitor();
            engine.sequence =
                payload.sequence;
        }

        const buffer =
            engine.ctx.createBuffer(
                channels,
                frames,
                sampleRate
            );

        if (channels === 1) {
            const mono =
                buffer.getChannelData(
                    0
                );

            for (
                let frame = 0;
                frame < frames;
                frame += 1
            ) {
                mono[frame] =
                    samples[frame];
            }
        } else {
            const left =
                buffer.getChannelData(
                    0
                );
            const right =
                buffer.getChannelData(
                    1
                );

            for (
                let frame = 0;
                frame < frames;
                frame += 1
            ) {
                const offset =
                    frame * 2;
                left[frame] =
                    samples[offset];
                right[frame] =
                    samples[
                        offset + 1
                    ];
            }
        }

        const source =
            engine.ctx
                .createBufferSource();

        source.buffer =
            buffer;
        source.connect(
            engine.gain
        );
        source.onended = () => {
            engine.sources.delete(
                source
            );
            try {
                source.disconnect();
            } catch {
                // Já desconectado.
            }
        };

        const now =
            engine.ctx.currentTime;

        // O monitor é operacional, não um buffer de contribuição.
        // Se o renderer atrasar, descartamos a latência acumulada em vez
        // de tocar áudio antigo segundos depois do PROGRAM.
        if (
            engine.nextStart <
                now + 0.008 ||
            engine.nextStart - now >
                0.35
        ) {
            engine.nextStart =
                now + 0.025;
        }

        source.start(
            engine.nextStart
        );
        engine.sources.add(
            source
        );
        engine.nextStart +=
            frames / sampleRate;

        if (
            engine.ctx.state ===
            "suspended"
        ) {
            void engine.ctx.resume()
                .catch(() => {
                    setMonitorSuspended(
                        true
                    );
                });
        }
    }

    useEffect(() => {
        monitorEnabledRef.current =
            monitorEnabled;

        window.localStorage.setItem(
            "santtos-program-audio-monitor",
            monitorEnabled
                ? "on"
                : "off"
        );

        const current =
            monitor.current;

        if (current) {
            current.gain.gain.setValueAtTime(
                monitorEnabled
                    ? 1
                    : 0,
                current.ctx.currentTime
            );
        }

        if (!monitorEnabled) {
            resetRealMonitor();
        }
    }, [monitorEnabled]);

    useEffect(() => {
        isPlayingRef.current =
            isPlaying;

        if (!isPlaying) {
            resetRealMonitor();
        }
    }, [isPlaying]);

    useEffect(() => {
        const unsubscribePcm =
            window.santtosAPI
                .onProgramAudioPcm(
                    (
                        payload:
                            ProgramPcmPayload
                    ) =>
                        queueRealPcm(
                            payload
                        )
                );
        const unsubscribeReset =
            window.santtosAPI
                .onProgramAudioReset(
                    (payload) => {
                        const current =
                            monitor.current;

                        if (current) {
                            current.sequence =
                                payload.sequence;
                        }

                        resetRealMonitor();
                    }
                );

        return () => {
            unsubscribePcm();
            unsubscribeReset();

            const current =
                monitor.current;
            monitor.current =
                null;

            if (current) {
                for (
                    const source of
                    current.sources
                ) {
                    try {
                        source.stop();
                    } catch {
                        // Já terminou.
                    }
                }

                current.sources.clear();
                current.ctx.onstatechange =
                    null;
                void current.ctx
                    .close()
                    .catch(() => {});
            }
        };
    }, []);

    useEffect(() => {
        // Em operação nativa o medidor não usa a prévia Chromium:
        // ele lê o PCM real do mesmo decoder que alimenta o NDI/monitor.
        if (
            nativeOutput ||
            !mediaUrl
        ) {
            return;
        }

        const element =
            videoRef.current;

        if (!element) return;

        try {
            const ctx =
                new AudioContext();
            const source =
                ctx.createMediaElementSource(
                    element
                );
            const splitter =
                ctx.createChannelSplitter(
                    2
                );
            const left =
                ctx.createAnalyser();
            const right =
                ctx.createAnalyser();

            left.fftSize =
                right.fftSize =
                    1024;
            source.connect(
                splitter
            );
            splitter.connect(
                left,
                0
            );
            splitter.connect(
                right,
                1
            );
            source.connect(
                ctx.destination
            );

            const nextGraph = {
                element,
                ctx,
                left,
                right,
                bufferL:
                    new Float32Array(
                        new ArrayBuffer(
                            4096
                        )
                    ),
                bufferR:
                    new Float32Array(
                        new ArrayBuffer(
                            4096
                        )
                    ),
                peakL: -60,
                peakR: -60
            };

            graph.current =
                nextGraph;
            ctx.onstatechange = () => {
                setPreviewSuspended(
                    ctx.state ===
                        "suspended"
                );
            };
            setPreviewSuspended(
                ctx.state ===
                    "suspended"
            );
            setPreviewError("");

            return () => {
                if (
                    graph.current ===
                    nextGraph
                ) {
                    graph.current =
                        null;
                }

                ctx.onstatechange =
                    null;
                void ctx.close()
                    .catch(() => {});
            };
        } catch (error) {
            setPreviewError(
                "Monitor de prévia indisponível"
            );
            console.error(
                "Falha no medidor de prévia:",
                error
            );
        }
    }, [
        mediaUrl,
        videoRef,
        nativeOutput
    ]);

    useEffect(() => {
        if (
            nativeOutput ||
            !isPlaying
        ) {
            setPreview(
                SILENT
            );
            return;
        }

        const activeGraph =
            graph.current;

        if (!activeGraph) return;

        void activeGraph.ctx.resume()
            .then(() =>
                setPreviewSuspended(
                    activeGraph.ctx.state ===
                        "suspended"
                )
            )
            .catch(error => {
                setPreviewSuspended(
                    true
                );
                console.warn(
                    "AudioContext suspenso:",
                    error
                );
            });

        function level(
            buffer: Float32Array
        ) {
            let sum = 0;
            let peak = 0;

            for (
                let i = 0;
                i < buffer.length;
                i += 1
            ) {
                const magnitude =
                    Math.abs(
                        buffer[i]
                    );
                sum +=
                    magnitude *
                    magnitude;
                if (
                    magnitude >
                    peak
                ) {
                    peak =
                        magnitude;
                }
            }

            return {
                rms: db(
                    20 *
                    Math.log10(
                        Math.max(
                            0.001,
                            Math.sqrt(
                                sum /
                                buffer.length
                            )
                        )
                    )
                ),
                peak: db(
                    20 *
                    Math.log10(
                        Math.max(
                            0.001,
                            peak
                        )
                    )
                )
            };
        }

        const timer =
            window.setInterval(
                () => {
                    const current =
                        graph.current;

                    if (
                        !current ||
                        current.ctx.state !==
                            "running"
                    ) {
                        return;
                    }

                    current.left
                        .getFloatTimeDomainData(
                            current.bufferL
                        );
                    current.right
                        .getFloatTimeDomainData(
                            current.bufferR
                        );

                    const l =
                        level(
                            current.bufferL
                        );
                    const r =
                        level(
                            current.bufferR
                        );

                    current.peakL =
                        Math.max(
                            l.peak,
                            current.peakL -
                            1.5
                        );
                    current.peakR =
                        Math.max(
                            r.peak,
                            current.peakR -
                            1.5
                        );

                    setPreview({
                        l: l.rms,
                        r: r.rms,
                        pl:
                            current.peakL,
                        pr:
                            current.peakR
                    });
                },
                100
            );

        return () =>
            window.clearInterval(
                timer
            );
    }, [
        isPlaying,
        mediaUrl,
        nativeOutput
    ]);

    const programPcmAvailable =
        nativeOutput &&
        audio.state ===
            "FLOWING" &&
        audio.active === true;

    const reading: StereoValues =
        programPcmAvailable
            ? {
                l:
                    audio.leftDb ??
                    -60,
                r:
                    audio.rightDb ??
                    -60,
                pl:
                    audio.peakLeftDb ??
                    -60,
                pr:
                    audio.peakRightDb ??
                    -60
              }
            : !nativeOutput &&
              isPlaying
              ? preview
              : SILENT;

    const nativeLabel =
        audio.state ===
            "REBUILD_REQUIRED"
            ? "NDI ANTIGO"
        : audio.state ===
            "NO_TRACK"
            ? "SEM FAIXA"
        : audio.state ===
            "PIPE_NOT_READY"
            ? "PIPE OFF"
        : audio.state ===
            "ERROR"
            ? "ÁUDIO ERRO"
        : audio.state ===
            "STARTING"
            ? "CARREGANDO"
        : audio.state ===
            "ENDED"
            ? "ÁUDIO FIM"
        : "SEM PCM";

    const label =
        programPcmAvailable
            ? audio.nativeActive ===
              true
                ? "PROGRAM PCM · NDI"
                : "PROGRAM PCM"
            : nativeOutput
              ? nativeLabel
              : "PRÉVIA";

    return (
        <aside
            className="program-audio-meters"
            aria-label="Medidores de áudio L e R"
        >
            <div className="audio-meter-heading">
                ÁUDIO
            </div>
            <div className="audio-meter-reference">
                <span>0</span>
                <span>-12</span>
                <span>-24</span>
                <span>-36</span>
            </div>
            <div className="audio-meter-pair">
                {([
                    [
                        "L",
                        reading.l,
                        reading.pl
                    ],
                    [
                        "R",
                        reading.r,
                        reading.pr
                    ]
                ] as const).map(
                    ([
                        channel,
                        rms,
                        peak
                    ]) => (
                        <div
                            key={
                                channel
                            }
                            className="audio-meter-channel"
                        >
                            <div className="audio-meter-track">
                                <div
                                    className="audio-meter-fill"
                                    style={{
                                        height:
                                            percent(
                                                rms
                                            ) +
                                            "%"
                                    }}
                                />
                                <div
                                    className="audio-meter-peak"
                                    style={{
                                        bottom:
                                            percent(
                                                peak
                                            ) +
                                            "%"
                                    }}
                                />
                            </div>
                            <strong>
                                {
                                    channel
                                }
                            </strong>
                            <small>
                                {Math.round(
                                    db(rms)
                                )}
                            </small>
                        </div>
                    )
                )}
            </div>

            <div
                className="audio-meter-source"
                title={
                    audio.error ||
                    monitorError ||
                    previewError ||
                    label
                }
            >
                {label}
            </div>

            {nativeOutput && (
                <button
                    type="button"
                    className={
                        "audio-monitor-toggle" +
                        (
                            monitorEnabled
                                ? " active"
                                : ""
                        )
                    }
                    title={
                        monitorEnabled
                            ? "Ouvindo o PCM real do PROGRAM neste computador."
                            : "Ativar monitoração local do PCM real do PROGRAM."
                    }
                    onClick={() =>
                        setMonitorEnabled(
                            current =>
                                !current
                        )
                    }
                >
                    {monitorEnabled
                        ? "MONITOR ON"
                        : "MONITOR OFF"}
                </button>
            )}

            {monitorSuspended &&
                monitorEnabled &&
                isPlaying &&
                nativeOutput && (
                    <button
                        type="button"
                        className="audio-meter-activate"
                        title="O Chromium suspendeu a saída local. Clique para liberar o áudio real do PROGRAM."
                        onClick={() => {
                            const current =
                                ensureRealMonitor();

                            if (!current) {
                                return;
                            }

                            void current.ctx
                                .resume()
                                .then(() => {
                                    setMonitorSuspended(
                                        false
                                    );
                                    setMonitorError(
                                        ""
                                    );
                                })
                                .catch(() =>
                                    setMonitorError(
                                        "Sem acesso à saída de áudio local."
                                    )
                                );
                        }}
                    >
                        ATIVAR SOM
                    </button>
                )}

            {previewSuspended &&
                isPlaying &&
                !nativeOutput && (
                    <button
                        type="button"
                        className="audio-meter-activate"
                        title="O Chromium suspendeu o áudio da prévia."
                        onClick={() => {
                            void graph.current?.ctx
                                .resume()
                                .then(() =>
                                    setPreviewSuspended(
                                        false
                                    )
                                )
                                .catch(() =>
                                    setPreviewError(
                                        "Sem acesso ao áudio da prévia."
                                    )
                                );
                        }}
                    >
                        ATIVAR
                    </button>
                )}

            {nativeOutput && (
                <div
                    className="audio-meter-limitation"
                    title={
                        programPcmAvailable
                            ? "Os medidores e o monitor local usam o mesmo PCM decodificado para o PROGRAM."
                            : "Sem PCM real do PROGRAM; a prévia não é usada para fingir nível de saída."
                    }
                >
                    {programPcmAvailable
                        ? audio.nativeActive ===
                          true
                            ? "PCM REAL · NDI"
                            : "PCM REAL · LOCAL"
                        : "SEM PCM REAL"}
                </div>
            )}
        </aside>
    );
}
