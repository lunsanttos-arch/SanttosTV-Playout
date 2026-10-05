import {
    useEffect,
    useRef,
    useState
} from "react";

type ProgramState =
    | "IDLE"
    | "PLAYING"
    | "PAUSED"
    | "ENDED"
    | "FAULT";

interface Props {
    state: ProgramState;
}

type PreviewPayload = {
    sequence: number;
    mime: string;
    data: Uint8Array | ArrayBuffer;
};

function copyToArrayBuffer(
    data: Uint8Array | ArrayBuffer
): ArrayBuffer {
    if (data instanceof ArrayBuffer) {
        return data.slice(0);
    }

    const copy =
        new Uint8Array(
            data.byteLength
        );
    copy.set(data);

    return copy.buffer;
}

export default function NativeProgramPreview({
    state
}: Props) {
    const canvasRef =
        useRef<HTMLCanvasElement | null>(
            null
        );
    const activeSequenceRef =
        useRef(-1);
    const decodingRef =
        useRef(false);
    const pendingFrameRef =
        useRef<PreviewPayload | null>(
            null
        );
    const mountedRef =
        useRef(true);
    const hasFrameRef =
        useRef(false);
    const [hasFrame, setHasFrame] =
        useState(false);
    const [decodeError, setDecodeError] =
        useState("");

    function clearCanvas() {
        const canvas =
            canvasRef.current;

        if (canvas) {
            const context =
                canvas.getContext(
                    "2d"
                );

            context?.clearRect(
                0,
                0,
                canvas.width,
                canvas.height
            );
        }

        hasFrameRef.current =
            false;
        setHasFrame(false);
    }

    async function decodeFrame(
        payload: PreviewPayload
    ) {
        if (
            !mountedRef.current
        ) {
            return;
        }

        if (
            payload.sequence <
            activeSequenceRef.current
        ) {
            return;
        }

        if (
            payload.sequence >
            activeSequenceRef.current
        ) {
            activeSequenceRef.current =
                payload.sequence;
            pendingFrameRef.current =
                null;
        }

        if (decodingRef.current) {
            pendingFrameRef.current =
                payload;
            return;
        }

        decodingRef.current =
            true;

        try {
            let current:
                | PreviewPayload
                | null =
                payload;

            while (
                current &&
                mountedRef.current
            ) {
                pendingFrameRef.current =
                    null;

                const sequence =
                    current.sequence;
                const buffer =
                    copyToArrayBuffer(
                        current.data
                    );
                const blob =
                    new Blob(
                        [buffer],
                        {
                            type:
                                current.mime ||
                                "image/jpeg"
                        }
                    );

                const bitmap =
                    await createImageBitmap(
                        blob
                    );

                try {
                    if (
                        !mountedRef.current ||
                        sequence !==
                            activeSequenceRef.current
                    ) {
                        continue;
                    }

                    const canvas =
                        canvasRef.current;

                    if (!canvas) {
                        continue;
                    }

                    if (
                        canvas.width !==
                            bitmap.width ||
                        canvas.height !==
                            bitmap.height
                    ) {
                        canvas.width =
                            bitmap.width;
                        canvas.height =
                            bitmap.height;
                    }

                    const context =
                        canvas.getContext(
                            "2d",
                            {
                                alpha: false
                            }
                        );

                    if (!context) {
                        throw new Error(
                            "Canvas 2D indisponível."
                        );
                    }

                    context.drawImage(
                        bitmap,
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );

                    if (
                        !hasFrameRef.current
                    ) {
                        hasFrameRef.current =
                            true;
                        setHasFrame(true);
                    }

                    if (decodeError) {
                        setDecodeError("");
                    }
                } finally {
                    bitmap.close();
                }

                current =
                    pendingFrameRef.current;
            }
        } catch (error) {
            if (
                mountedRef.current
            ) {
                setDecodeError(
                    error instanceof Error
                        ? error.message
                        : String(error)
                );
            }
        } finally {
            decodingRef.current =
                false;

            const pending =
                pendingFrameRef.current;

            if (
                pending &&
                mountedRef.current
            ) {
                pendingFrameRef.current =
                    null;
                void decodeFrame(
                    pending
                );
            }
        }
    }

    useEffect(() => {
        mountedRef.current =
            true;

        const unsubscribeFrame =
            window.santtosAPI
                .onProgramPreviewFrame(
                    (
                        payload:
                            PreviewPayload
                    ) => {
                        if (
                            payload.sequence >
                            activeSequenceRef.current
                        ) {
                            activeSequenceRef.current =
                                payload.sequence;
                        }

                        if (
                            decodingRef.current
                        ) {
                            // Último frame vence: nunca formamos fila de preview.
                            pendingFrameRef.current =
                                payload;
                            return;
                        }

                        void decodeFrame(
                            payload
                        );
                    }
                );

        const unsubscribeReset =
            window.santtosAPI
                .onProgramPreviewReset(
                    (payload) => {
                        activeSequenceRef.current =
                            payload.sequence;
                        pendingFrameRef.current =
                            null;
                        clearCanvas();
                        setDecodeError("");
                    }
                );

        return () => {
            mountedRef.current =
                false;
            pendingFrameRef.current =
                null;
            unsubscribeFrame();
            unsubscribeReset();
        };
    }, []);

    const statusTitle =
        state === "PLAYING"
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
                aria-label="Prévia exata do PROGRAM nativo"
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
