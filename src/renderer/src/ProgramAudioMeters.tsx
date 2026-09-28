import { useEffect, useRef, useState } from "react";
import { audioMeterSourceLabel, resolveAudioMeterRoute } from "./program-audio-display";

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

type StereoValues = { l: number; r: number; pl: number; pr: number };
const SILENT: StereoValues = { l: -60, r: -60, pl: -60, pr: -60 };

function db(value: number) {
    return Math.max(-60, Math.min(3, Number.isFinite(value) ? value : -60));
}
function percent(value: number) {
    return Math.round(Math.max(0, Math.min(100, ((db(value) + 60) / 60) * 100)));
}
function level(buffer: Float32Array) {
    let energy = 0;
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
        const value = Number.isFinite(buffer[i]) ? Math.abs(buffer[i]) : 0;
        energy += value * value;
        peak = Math.max(peak, value);
    }
    return {
        rms: db(20 * Math.log10(Math.max(0.001, Math.sqrt(energy / buffer.length)))),
        peak: db(20 * Math.log10(Math.max(0.001, peak)))
    };
}

interface PreviewGraph {
    element: HTMLVideoElement;
    ctx: AudioContext;
    left: AnalyserNode;
    right: AnalyserNode;
    bufferL: Float32Array<ArrayBuffer>;
    bufferR: Float32Array<ArrayBuffer>;
    peakL: number;
    peakR: number;
}

export default function ProgramAudioMeters({
    videoRef, mediaUrl, isPlaying, nativeOutput, audio
}: Props) {
    const [preview, setPreview] = useState<StereoValues>(SILENT);
    const [previewError, setPreviewError] = useState("");
    const [previewContextState, setPreviewContextState] =
        useState<AudioContextState | "none">("none");
    const graph = useRef<PreviewGraph | null>(null);

    const route = resolveAudioMeterRoute({
        nativeOutput,
        isPlaying,
        nativeState: audio.state,
        nativeActive: audio.active
    });

    // Connect to the player's *actual* media element. A previous revision
    // disabled this entire graph in NDI mode, leaving old video-only senders
    // with permanently silent meters despite a healthy local preview.
    useEffect(() => {
        if (!mediaUrl || !isPlaying || route !== "preview") {
            if (!mediaUrl && graph.current) {
                const old = graph.current;
                graph.current = null;
                old.ctx.onstatechange = null;
                void old.ctx.close().catch(() => {});
                setPreviewContextState("none");
            }
            return;
        }
        const element = videoRef.current;
        if (!element || graph.current?.element === element) return;
        if (graph.current) {
            graph.current.ctx.onstatechange = null;
            void graph.current.ctx.close().catch(() => {});
            graph.current = null;
        }
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
            // MediaElementAudioSource takes ownership of local audio routing.
            // Always return it to the operator's preview output.
            source.connect(ctx.destination);
            const next: PreviewGraph = {
                element, ctx, left, right,
                bufferL: new Float32Array(new ArrayBuffer(4096)),
                bufferR: new Float32Array(new ArrayBuffer(4096)),
                peakL: -60, peakR: -60
            };
            graph.current = next;
            ctx.onstatechange = () => setPreviewContextState(ctx.state);
            setPreviewContextState(ctx.state);
            setPreviewError("");
            void ctx.resume().then(
                () => setPreviewContextState(ctx.state),
                () => setPreviewContextState(ctx.state)
            );
        } catch (error) {
            setPreviewError("Falha ao iniciar medidor da prévia");
            console.error("Medidor de áudio da prévia:", error);
        }
    }, [mediaUrl, isPlaying, videoRef, route]);

    // Auto-resume after an actual PLAY, including a pause/resume or a new
    // video. If Chromium refuses autoplay for WebAudio, expose a real user
    // interaction below rather than showing unlabelled, motionless meters.
    useEffect(() => {
        const current = graph.current;
        if (!current || !isPlaying || current.ctx.state !== "suspended") return;
        void current.ctx.resume().then(
            () => setPreviewContextState(current.ctx.state),
            () => setPreviewContextState(current.ctx.state)
        );
    }, [isPlaying, mediaUrl, route]);

    useEffect(() => {
        if (!isPlaying || !mediaUrl || route !== "preview") {
            setPreview(SILENT);
            return;
        }
        const timer = window.setInterval(() => {
            const current = graph.current;
            if (!current || current.ctx.state !== "running") return;
            current.left.getFloatTimeDomainData(current.bufferL);
            current.right.getFloatTimeDomainData(current.bufferR);
            const left = level(current.bufferL);
            const right = level(current.bufferR);
            current.peakL = Math.max(left.peak, current.peakL -1.5);
            current.peakR = Math.max(right.peak, current.peakR -1.5);
            setPreview({
                l: left.rms, r: right.rms,
                pl: current.peakL, pr: current.peakR
            });
        }, 100);
        return () => window.clearInterval(timer);
    }, [isPlaying, mediaUrl, route]);

    useEffect(() => () => {
        const old = graph.current;
        graph.current = null;
        if (old) {
            old.ctx.onstatechange = null;
            void old.ctx.close().catch(() => {});
        }
    }, []);

    async function activateMeters() {
        const current = graph.current;
        if (!current) {
            setPreviewError("Inicia primeiro um vídeo com áudio.");
            return;
        }
        try {
            await current.ctx.resume();
            setPreviewContextState(current.ctx.state);
            setPreviewError("");
        } catch (error) {
            setPreviewError("O Chromium bloqueou o medidor de áudio.");
            console.error("Não foi possível ativar os medidores:", error);
        }
    }

    const reading: StereoValues = route === "ndi"
        ? {
            l: audio.leftDb ?? -60, r: audio.rightDb ?? -60,
            pl: audio.peakLeftDb ?? -60, pr: audio.peakRightDb ?? -60
        }
        : route === "preview" && previewContextState === "running"
            ? preview
            : SILENT;
    const sourceLabel = audioMeterSourceLabel(route, audio.state);
    const needsActivation = route === "preview" && isPlaying &&
        previewContextState === "suspended";
    const noPreviewSignal = route === "preview" && isPlaying &&
        previewContextState === "running" &&
        preview.l <= -59 && preview.r <= -59;

    return (
        <aside className="program-audio-meters" aria-label="Medidores de áudio L e R">
            <div className="audio-meter-heading">ÁUDIO</div>
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
                                style={{
                                    bottom: percent(peak) + "%",
                                    opacity: peak <= -59 ? 0 : 1
                                }} />
                        </div>
                        <strong>{channel}</strong>
                        <small>{Math.round(db(rms))}</small>
                    </div>
                ))}
            </div>
            <div className="audio-meter-source"
                title={audio.error || previewError || sourceLabel}>
                {sourceLabel}
            </div>
            {needsActivation && (
                <button type="button" className="audio-meter-activate"
                    onClick={() => void activateMeters()}>
                    Ativar barras
                </button>
            )}
            {route === "preview" && nativeOutput && (
                <div className="audio-meter-warning" role="status"
                    title={audio.error || "O áudio da saída NDI ainda não está confirmado."}>
                    NDI não medido
                </div>
            )}
            {previewError && route === "preview" && (
                <div className="audio-meter-warning" role="status"
                    title={previewError}>
                    Erro prévia
                </div>
            )}
            {noPreviewSignal && (
                <div className="audio-meter-limitation"
                    title="O analisador não detectou sinal no momento. Verifique se o arquivo possui áudio e se o Chromium decodifica a faixa.">
                    -60 dB
                </div>
            )}
            {route === "ndi" && (
                <div className="audio-meter-limitation"
                    title="PCM antes da saída NDI. Confirme áudio e sincronismo no vMix.">
                    FONTE
                </div>
            )}
        </aside>
    );
}
