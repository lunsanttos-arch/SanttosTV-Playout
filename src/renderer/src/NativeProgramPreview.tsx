import { useEffect, useRef, useState } from "react";
import { programMonitorClock } from "./program-monitor-clock.mjs";
import type { MonitorTiming, VideoPlan } from "./program-monitor-clock.mjs";

type ProgramState = "IDLE" | "STARTING" | "PLAYING" | "PAUSED" | "ENDED" | "FAULT";
interface Props { state: ProgramState }
type PreviewPayload = MonitorTiming & { sequence: number; mime: string; data: Uint8Array | ArrayBuffer };

export default function NativeProgramPreview({ state }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pendingFrameRef = useRef<PreviewPayload | null>(null);
    const [hasFrame, setHasFrame] = useState(false);
    const [decodeError, setDecodeError] = useState("");
    useEffect(() => {
        let mounted = true, decoding = false, activeSequence = -1, activeStream: string | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let ready: { bitmap: ImageBitmap; plan: VideoPlan }[] = [];
        function clearReady() {
            clearTimeout(timer); timer = undefined;
            for (const frame of ready) frame.bitmap.close();
            ready = [];
        }
        function present() {
            timer = undefined;
            let latest: typeof ready[number] | undefined;
            while (ready.length && ready[0].plan.deadline <= programMonitorClock.now() + 1) {
                latest?.bitmap.close(); latest = ready.shift();
            }
            if (latest) {
                try {
                    const { bitmap, plan } = latest, canvas = canvasRef.current;
                    if (mounted && canvas && programMonitorClock.valid(plan)) {
                        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
                        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
                        const context = canvas.getContext("2d", { alpha: false });
                        if (!context) throw Error("Canvas 2D indisponível.");
                        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                        if (programMonitorClock.presented(plan)) {
                            canvas.dataset.monitorTime = String(plan.mediaTimeSeconds);
                            canvas.dataset.monitorEpoch = String(plan.epoch);
                            setHasFrame(true); setDecodeError("");
                        }
                    }
                } catch (error) { setDecodeError(String(error)); }
                finally { latest.bitmap.close(); }
            }
            if (ready.length) timer = setTimeout(present, Math.max(0, ready[0].plan.deadline - programMonitorClock.now()));
        }
        async function decodeFrame(payload: PreviewPayload) {
            if (!mounted || payload.sequence < activeSequence) return;
            activeSequence = payload.sequence;
            if (decoding) { pendingFrameRef.current = payload; return; }
            decoding = true;
            try {
                let current: PreviewPayload | null = payload;
                while (current && mounted) {
                    pendingFrameRef.current = null;
                    const plan = programMonitorClock.video(current);
                    if (plan) {
                        const bytes = new Uint8Array(current.data instanceof ArrayBuffer ? current.data : current.data.slice());
                        const bitmap = await createImageBitmap(new Blob([bytes.buffer], { type: current.mime || "image/jpeg" }));
                        if (!mounted || current.sequence !== activeSequence || !programMonitorClock.valid(plan)) bitmap.close();
                        else {
                            ready.push({ bitmap, plan });
                            while (ready.length > 8) ready.shift()!.bitmap.close();
                            if (!timer) timer = setTimeout(present, Math.max(0, ready[0].plan.deadline - programMonitorClock.now()));
                        }
                    }
                    current = pendingFrameRef.current;
                }
            } catch (error) { if (mounted) setDecodeError(error instanceof Error ? error.message : String(error)); }
            finally {
                decoding = false;
                const pending = pendingFrameRef.current;
                pendingFrameRef.current = null;
                if (pending && mounted) void decodeFrame(pending);
            }
        }
        const unsubscribeClock = programMonitorClock.subscribe(reset => { if (reset) clearReady(); });
        const unsubscribeFrame = window.santtosAPI.onProgramPreviewFrame(payload => {
            if (payload.streamId !== activeStream) { activeStream = payload.streamId; activeSequence = -1; }
            if (payload.sequence < activeSequence) return;
            activeSequence = payload.sequence;
            if (decoding) pendingFrameRef.current = payload;
            else void decodeFrame(payload);
        });
        const unsubscribeReset = window.santtosAPI.onProgramPreviewReset(payload => {
            activeSequence = payload.sequence; pendingFrameRef.current = null;
            programMonitorClock.reset(); clearReady();
            const canvas = canvasRef.current;
            if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            setHasFrame(false); setDecodeError("");
        });
        return () => {
            mounted = false; pendingFrameRef.current = null; clearReady();
            unsubscribeFrame(); unsubscribeReset(); unsubscribeClock();
        };
    }, []);

    const statusTitle =
        state === "STARTING" ? "ABRINDO INPUT"
        : state === "PLAYING"
            ? "PROGRAM NO AR"
            : state === "PAUSED"
              ? "PROGRAM PAUSADO"
              : state === "FAULT"
                ? "FALHA NO PROGRAM"
                : "PROGRAM OFF AIR";

    const statusText =
        state === "PLAYING"
            ? "Sincronizando monitor…"
            : state === "PAUSED"
              ? "Último quadro mantido."
              : "Aguardando o motor nativo.";

    return (
        <div
            className={
                "program-native-preview" +
                (
                    hasFrame
                        ? " has-frame"
                        : ""
                )
            }
        >
            <canvas
                ref={
                    canvasRef
                }
                className="program-video program-native-preview-canvas"
                aria-label="Monitor local do PROGRAM"
            />

            {!hasFrame && (
                <div className="program-live-input-preview program-native-preview-waiting">
                    <strong>
                        {statusTitle}
                    </strong>
                    <span>
                        {decodeError
                            ? "Falha ao desenhar o preview."
                            : statusText}
                    </span>
                    <small>
                        {decodeError
                            ? decodeError
                            : "O monitor usa os mesmos quadros do motor nativo."}
                    </small>
                </div>
            )}
        </div>
    );
}
