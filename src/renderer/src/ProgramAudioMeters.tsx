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

const SILENT: StereoValues = { l: -60, r: -60, pl: -60, pr: -60 };

function db(value: number) {
    return Math.max(-60, Math.min(3, Number.isFinite(value) ? value : -60));
}

function percent(value: number) {
    return Math.round(Math.max(0, Math.min(100, ((db(value) + 60) / 60) * 100)));
}

export default function ProgramAudioMeters({
    videoRef, mediaUrl, isPlaying, nativeOutput, audio
}: Props) {
    const [preview, setPreview] = useState<StereoValues>(SILENT);
    const [previewError, setPreviewError] = useState("");
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

    useEffect(() => {
        if (nativeOutput || !mediaUrl) return;
        const element = videoRef.current;
        if (!element || graph.current?.element === element) return;
        try {
            const ctx = new AudioContext();
            const source = ctx.createMediaElementSource(element);
            const splitter = ctx.createChannelSplitter(2);
            const left = ctx.createAnalyser();
            const right = ctx.createAnalyser();
            left.fftSize = right.fftSize = 1024;
            source.connect(splitter);
            splitter.connect(left, 0);
            splitter.connect(right, 1);
            // MediaElementSource takes over the video element audio output:
            // reconnect it so the operator still hears the preview.
            source.connect(ctx.destination);
            graph.current = {
                element, ctx, left, right,
                bufferL: new Float32Array(new ArrayBuffer(4096)),
                bufferR: new Float32Array(new ArrayBuffer(4096)),
                peakL: -60, peakR: -60
            };
            setPreviewError("");
        } catch (error) {
            setPreviewError("Monitor de prévia indisponível");
            console.error("Falha no medidor de prévia:", error);
        }
    }, [mediaUrl, videoRef, nativeOutput]);

    useEffect(() => {
        if (nativeOutput || !isPlaying) {
            if (!nativeOutput) setPreview(SILENT);
            return;
        }
        const activeGraph = graph.current;
        if (!activeGraph) return;
        void activeGraph.ctx.resume().catch(error =>
            console.warn("AudioContext suspenso:", error)
        );
        function level(buffer: Float32Array) {
            let sum = 0;
            let peak = 0;
            for (let i = 0; i < buffer.length; ++i) {
                const magnitude = Math.abs(buffer[i]);
                sum += magnitude * magnitude;
                if (magnitude > peak) peak = magnitude;
            }
            return {
                rms: db(20 * Math.log10(Math.max(0.001,
                    Math.sqrt(sum / buffer.length)))),
                peak: db(20 * Math.log10(Math.max(0.001, peak)))
            };
        }
        const timer = window.setInterval(() => {
            const current = graph.current;
            if (!current || current.ctx.state !== "running") return;
            current.left.getFloatTimeDomainData(current.bufferL);
            current.right.getFloatTimeDomainData(current.bufferR);
            const l = level(current.bufferL);
            const r = level(current.bufferR);
            current.peakL = Math.max(l.peak, current.peakL - 1.5);
            current.peakR = Math.max(r.peak, current.peakR - 1.5);
            setPreview({
                l: l.rms, r: r.rms,
                pl: current.peakL, pr: current.peakR
            });
        }, 100);
        return () => window.clearInterval(timer);
    }, [isPlaying, nativeOutput]);

    useEffect(() => () => {
        const current = graph.current;
        if (current) void current.ctx.close().catch(() => {});
        graph.current = null;
    }, []);

    const reading: StereoValues = nativeOutput
        ? audio.state === "FLOWING" && audio.active !== false
            ? {
                l: audio.leftDb ?? -60, r: audio.rightDb ?? -60,
                pl: audio.peakLeftDb ?? -60, pr: audio.peakRightDb ?? -60
              }
            : SILENT
        : isPlaying ? preview : SILENT;

    const label = nativeOutput
        ? audio.state === "FLOWING" ? "NDI PCM"
          : audio.state === "NO_TRACK" ? "SEM FAIXA"
          : audio.state === "REBUILD_REQUIRED" ? "NDI ANTIGO"
          : audio.state === "ERROR" ? "ÁUDIO ERRO"
          : audio.state === "PIPE_NOT_READY" ? "PIPE OFF"
          : audio.state === "STARTING" ? "CARREGANDO"
          : "NDI ÁUDIO"
        : "PRÉVIA";

    return (
        <aside className="program-audio-meters"
            aria-label="Medidores de áudio L e R">
            <div className="audio-meter-heading">ÁUDIO</div>
            <div className="audio-meter-reference">
                <span>0</span><span>-12</span><span>-24</span><span>-36</span>
            </div>
            <div className="audio-meter-pair">
                {([
                    ["L", reading.l, reading.pl],
                    ["R", reading.r, reading.pr]
                ] as const).map(([channel, rms, peak]) => (
                    <div key={channel} className="audio-meter-channel">
                        <div className="audio-meter-track">
                            <div className="audio-meter-fill"
                                style={{ height: percent(rms) + "%" }} />
                            <div className="audio-meter-peak"
                                style={{ bottom: percent(peak) + "%" }} />
                        </div>
                        <strong>{channel}</strong>
                        <small>{Math.round(db(rms))}</small>
                    </div>
                ))}
            </div>
            <div className="audio-meter-source" title={audio.error || previewError || label}>
                {previewError || label}
            </div>
            {nativeOutput && (
                <div className="audio-meter-limitation" title="Mede fonte PCM, não o áudio recebido no vMix">
                    FONTE
                </div>
            )}
        </aside>
    );
}
