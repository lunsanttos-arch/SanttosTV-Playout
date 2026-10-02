import { Component, useEffect, useMemo, useState } from "react";
import type { DragEvent, ErrorInfo, ReactNode } from "react";
import type { MediaItem } from "./App";

export interface WebInput {
    id: string;
    name: string;
    url: string;
    protocol: "http" | "https" | "hls" | "m3u8" | "srt";
    timingMode: "duration" | "clock";
    durationSeconds: number;
    endTime: string;
    fitMode: "contain" | "cover" | "stretch";
    sizePercent: number;
    httpReferer: string;
    httpUserAgent: string;
    engine: "auto" | "ffmpeg" | "vlc";
    premiumFeature: true;
    createdAt: string;
}

interface Props {
    onAddToTimeline: (
        media: MediaItem
    ) => void;
}

const EMPTY_INPUT: Omit<
    WebInput,
    "id" | "createdAt" | "premiumFeature"
> = {
    name: "",
    url: "",
    protocol: "http",
    timingMode: "duration",
    durationSeconds: 60,
    endTime: "00:01:00",
    fitMode: "contain",
    sizePercent: 100,
    httpReferer: "",
    httpUserAgent: "",
    engine: "auto"
};

function secondsUntilClock(
    endTime: string,
    now = new Date()
) {
    const parts =
        endTime.split(":").map(Number);

    const end = new Date(now);
    end.setHours(
        parts[0] || 0,
        parts[1] || 0,
        parts[2] || 0,
        0
    );

    if (
        end.getTime() <=
        now.getTime()
    ) {
        end.setDate(
            end.getDate() + 1
        );
    }

    return Math.max(
        1,
        Math.round(
            (
                end.getTime() -
                now.getTime()
            ) / 1000
        )
    );
}

function formatDuration(seconds: number) {
    const safe = Math.max(
        0,
        Math.floor(seconds)
    );
    const h = Math.floor(
        safe / 3600
    );
    const m = Math.floor(
        (safe % 3600) / 60
    );
    const s = safe % 60;

    return [h, m, s]
        .map((value) =>
            String(value)
                .padStart(2, "0")
        )
        .join(":");
}

function sanitizePastedUrl(value: string) {
    return String(value ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .replace(/^<(.+)>$/, "$1")
        .slice(0, 4096);
}

function protocolFromUrl(
    value: string
): WebInput["protocol"] | null {
    const url =
        sanitizePastedUrl(value)
            .toLowerCase();

    if (url.startsWith("srt://")) {
        return "srt";
    }

    if (
        url.startsWith("http://") ||
        url.startsWith("https://")
    ) {
        if (
            /\.m3u8(?:[?#]|$)/i.test(url)
        ) {
            return "hls";
        }

        return url.startsWith("https://")
            ? "https"
            : "http";
    }

    return null;
}

function validateDraftUrl(value: string) {
    const url = sanitizePastedUrl(value);

    if (!url) {
        return {
            ok: false,
            url,
            error:
                "Cole um endereço HTTP/HTTPS, M3U8 ou SRT."
        };
    }

    if (
        !/^(https?:\/\/|srt:\/\/)/i.test(
            url
        )
    ) {
        return {
            ok: false,
            url,
            error:
                "Formato não suportado. Use http://, https:// ou srt://."
        };
    }

    return {
        ok: true,
        url,
        error: ""
    };
}

class WebInputsErrorBoundary extends Component<
    { children: ReactNode },
    { message: string }
> {
    state = {
        message: ""
    };

    static getDerivedStateFromError(
        error: Error
    ) {
        return {
            message:
                error?.message ||
                "Falha inesperada no módulo de Inputs."
        };
    }

    componentDidCatch(
        error: Error,
        info: ErrorInfo
    ) {
        console.error(
            "Falha isolada no módulo de Inputs:",
            error,
            info
        );
    }

    render() {
        if (this.state.message) {
            return (
                <div className="web-inputs-recovery">
                    <strong>
                        O módulo de Inputs encontrou um erro.
                    </strong>
                    <span>
                        {this.state.message}
                    </span>
                    <button
                        type="button"
                        onClick={() =>
                            this.setState({
                                message: ""
                            })
                        }
                    >
                        Reabrir Inputs
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

function WebInputsContent({
    onAddToTimeline
}: Props) {
    const [inputs, setInputs] =
        useState<WebInput[]>([]);
    const [draft, setDraft] =
        useState(EMPTY_INPUT);
    const [editingId, setEditingId] =
        useState<string | null>(null);
    const [status, setStatus] =
        useState("");
    const [saving, setSaving] =
        useState(false);

    async function load() {
        const result =
            await window.santtosAPI
                .getWebInputs();

        if (result.ok) {
            setInputs(
                result.inputs ?? []
            );
        }
    }

    useEffect(() => {
        void load().catch(
            (error) => {
                console.error(error);
                setStatus(
                    "Não foi possível carregar os Inputs."
                );
            }
        );
    }, []);

    const previewDuration =
        useMemo(
            () =>
                draft.timingMode ===
                "clock"
                    ? secondsUntilClock(
                          draft.endTime
                      )
                    : Math.max(
                          1,
                          Number(
                              draft.durationSeconds
                          ) || 1
                      ),
            [
                draft.timingMode,
                draft.endTime,
                draft.durationSeconds
            ]
        );

    function edit(
        input: WebInput
    ) {
        setEditingId(
            input.id
        );
        setDraft({
            name: input.name,
            url: input.url,
            protocol:
                input.protocol,
            timingMode:
                input.timingMode,
            durationSeconds:
                input.durationSeconds,
            endTime:
                input.endTime,
            fitMode:
                input.fitMode,
            sizePercent:
                input.sizePercent ?? 100,
            httpReferer:
                input.httpReferer ?? "",
            httpUserAgent:
                input.httpUserAgent ?? "",
            engine:
                input.engine ?? "auto"
        });
        setStatus("");
    }

    function clear() {
        setEditingId(null);
        setDraft(
            EMPTY_INPUT
        );
    }

    async function save() {
        if (saving) return;

        setStatus("");

        const checked =
            validateDraftUrl(
                draft.url
            );

        if (!checked.ok) {
            setStatus(
                checked.error
            );
            return;
        }

        const detectedProtocol =
            protocolFromUrl(
                checked.url
            );

        setSaving(true);

        try {
            const result =
                await window.santtosAPI
                    .saveWebInput({
                        ...draft,
                        url:
                            checked.url,
                        protocol:
                            detectedProtocol ??
                            draft.protocol,
                        id:
                            editingId ??
                            undefined
                    });

            if (!result?.ok) {
                setStatus(
                    result?.error ??
                        "Não foi possível salvar o Input."
                );
                return;
            }

            setInputs(
                result.inputs ?? []
            );
            clear();
            setStatus(
                "Input salvo."
            );
        } catch (error) {
            console.error(
                "Falha ao salvar Input:",
                error
            );
            setStatus(
                "O link não pôde ser salvo. O módulo foi preservado e continua funcionando."
            );
        } finally {
            setSaving(false);
        }
    }

    async function remove(
        id: string
    ) {
        try {
            const result =
                await window.santtosAPI
                    .removeWebInput(id);

            if (result?.ok) {
                setInputs(
                    result.inputs ?? []
                );
                if (
                    editingId === id
                ) {
                    clear();
                }
                return;
            }

            setStatus(
                result?.error ??
                    "Não foi possível remover o Input."
            );
        } catch (error) {
            console.error(
                "Falha ao remover Input:",
                error
            );
            setStatus(
                "Não foi possível remover o Input."
            );
        }
    }

    function buildTimelineMedia(
        input: WebInput
    ): MediaItem {
        const duration =
            input.timingMode === "clock"
                ? secondsUntilClock(
                      input.endTime
                  )
                : Math.max(
                      1,
                      input.durationSeconds
                  );

        return {
            id:
                `input-${input.id}-${Date.now()}`,
            sourceMediaId:
                `input:${input.id}`,
            sourceType:
                "input",
            inputId:
                input.id,
            inputProtocol:
                input.protocol,
            inputTimingMode:
                input.timingMode,
            inputEndTime:
                input.endTime,
            inputHttpReferer:
                input.httpReferer ?? "",
            inputHttpUserAgent:
                input.httpUserAgent ?? "",
            inputEngine:
                input.engine ?? "auto",
            fitMode:
                input.fitMode,
            sizePercent:
                input.sizePercent ?? 100,
            premiumFeature:
                true,
            programmedStartTime:
                "00:00",
            name:
                input.name,
            path:
                input.url,
            extension:
                input.protocol ===
                    "srt"
                    ? "SRT"
                    : input.protocol ===
                          "hls" ||
                      input.protocol ===
                          "m3u8"
                      ? "M3U8"
                      : "WEB",
            fileSize: 0,
            duration,
            width: null,
            height: null,
            fps: null,
            videoCodec:
                "STREAM",
            audioCodec: null,
            videoStreamIndex: null,
            audioStreamIndex: null,
            timingMode:
                "unknown",
            isVariableFrameRate:
                false,
            rotation: 0,
            sampleAspectRatio: null,
            decoderMode:
                "software",
            thumbnail: null,
            status: "stream",
            createdAt:
                new Date().toISOString(),
            loop: false,
            freezeEnd: false,
            watermark: false,
            hashtag: "",
            inPoint: 0,
            outPoint:
                duration,
            blockLabel:
                "INPUT"
        };
    }

    function addToTimeline(
        input: WebInput
    ) {
        const mediaItem =
            buildTimelineMedia(
                input
            );

        onAddToTimeline(
            mediaItem
        );

        setStatus(
            `${input.name} adicionado à Timeline por ${formatDuration(mediaItem.duration ?? 0)}.`
        );
    }

    function startInputDrag(
        event: DragEvent<HTMLElement>,
        input: WebInput
    ) {
        const mediaItem =
            buildTimelineMedia(
                input
            );

        event.dataTransfer.effectAllowed =
            "copy";
        event.dataTransfer.setData(
            "application/x-santtos-timeline-item",
            JSON.stringify(
                mediaItem
            )
        );
        event.dataTransfer.setData(
            "text/plain",
            input.name
        );
    }

    return (
        <div className="web-inputs-panel">
            <div className="web-input-editor">
                <div className="web-input-premium">
                    INPUTS · MÓDULO PREMIUM
                </div>

                <label>
                    <span>Nome</span>
                    <input
                        value={
                            draft.name
                        }
                        placeholder="Ex.: Rede / Link externo"
                        onChange={(event) => {
                            const value =
                                event.currentTarget.value;
                            setDraft(
                                (current) => ({
                                    ...current,
                                    name: value
                                })
                            );
                        }}
                    />
                </label>

                <label>
                    <span>URL / endereço</span>
                    <input
                        value={
                            draft.url
                        }
                        placeholder="https://...m3u8 ou srt://..."
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={4096}
                        onPaste={(event) => {
                            event.preventDefault();
                            const pasted =
                                sanitizePastedUrl(
                                    event.clipboardData
                                        .getData(
                                            "text/plain"
                                        )
                                );
                            const detected =
                                protocolFromUrl(
                                    pasted
                                );
                            setDraft(
                                (current) => ({
                                    ...current,
                                    url:
                                        pasted,
                                    protocol:
                                        detected ??
                                        current.protocol
                                })
                            );
                            setStatus("");
                        }}
                        onChange={(event) => {
                            const value =
                                sanitizePastedUrl(
                                    event.currentTarget
                                        .value
                                );
                            const detected =
                                protocolFromUrl(
                                    value
                                );
                            setDraft(
                                (current) => ({
                                    ...current,
                                    url:
                                        value,
                                    protocol:
                                        detected ??
                                        current.protocol
                                })
                            );
                        }}
                    />
                </label>

                {draft.protocol !== "srt" && (
                    <details className="web-input-http-options">
                        <summary>Compatibilidade HTTP</summary>
                        <div className="web-input-http-options-body">
                            <label>
                                <span>Referer (opcional)</span>
                                <input
                                    value={draft.httpReferer}
                                    placeholder={
                                        /dailymotion\.com/i.test(draft.url)
                                            ? "Automático: https://www.dailymotion.com/"
                                            : "Ex.: https://site-origem.com/"
                                    }
                                    inputMode="url"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    maxLength={2048}
                                    onChange={(event) => {
                                        const value =
                                            event.currentTarget.value
                                                .replace(/[\r\n\u0000]/g, "")
                                                .slice(0, 2048);
                                        setDraft(
                                            (current) => ({
                                                ...current,
                                                httpReferer:
                                                    value
                                            })
                                        );
                                    }}
                                />
                            </label>
                            <label>
                                <span>User-Agent (opcional)</span>
                                <input
                                    value={draft.httpUserAgent}
                                    placeholder="Automático: navegador Windows/Chrome"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    maxLength={512}
                                    onChange={(event) => {
                                        const value =
                                            event.currentTarget.value
                                                .replace(/[\r\n\u0000]/g, "")
                                                .slice(0, 512);
                                        setDraft(
                                            (current) => ({
                                                ...current,
                                                httpUserAgent:
                                                    value
                                            })
                                        );
                                    }}
                                />
                            </label>
                            <small>
                                Use estes campos apenas quando a CDN exigir identidade HTTP.
                                Dailymotion recebe Referer e User-Agent compatíveis automaticamente.
                            </small>
                        </div>
                    </details>
                )}

                <div className="web-input-row">
                    <label>
                        <span>Protocolo</span>
                        <select
                            value={
                                draft.protocol
                            }
                            onChange={(event) => {
                                const value =
                                    event.currentTarget
                                        .value as WebInput["protocol"];
                                setDraft(
                                    (current) => ({
                                        ...current,
                                        protocol:
                                            value
                                    })
                                );
                            }}
                        >
                            <option value="http">
                                HTTP
                            </option>
                            <option value="https">
                                HTTPS
                            </option>
                            <option value="hls">
                                HLS / M3U8
                            </option>
                            <option value="srt">
                                SRT
                            </option>
                        </select>
                    </label>

                    <label>
                        <span>Motor do Input</span>
                        <select
                            value={
                                draft.engine
                            }
                            onChange={(event) => {
                                const value =
                                    event.currentTarget
                                        .value as WebInput["engine"];
                                setDraft(
                                    (current) => ({
                                        ...current,
                                        engine:
                                            value
                                    })
                                );
                            }}
                        >
                            <option value="auto">
                                Automático
                            </option>
                            <option value="ffmpeg">
                                FFmpeg
                            </option>
                            <option value="vlc">
                                VLC
                            </option>
                        </select>
                    </label>

                    <label>
                        <span>Tamanho no PROGRAM</span
                        <select
                            value={
                                draft.fitMode
                            }
                            onChange={(event) => {
                                const value =
                                    event.currentTarget
                                        .value as WebInput["fitMode"];
                                setDraft(
                                    (current) => ({
                                        ...current,
                                        fitMode:
                                            value
                                    })
                                );
                            }}
                        >
                            <option value="contain">
                                Ajustar
                            </option>
                            <option value="cover">
                                Preencher
                            </option>
                            <option value="stretch">
                                Esticar
                            </option>
                        </select>
                    </label>
                </div>

                <label className="web-input-size-field">
                    <span>
                        Tamanho no PROGRAM
                        <strong>
                            {draft.sizePercent}%
                        </strong>
                    </span>
                    <input
                        type="range"
                        min={10}
                        max={100}
                        step={1}
                        value={draft.sizePercent}
                        onChange={(event) => {
                            const value =
                                Number(
                                    event.currentTarget.value
                                );
                            setDraft(
                                (current) => ({
                                    ...current,
                                    sizePercent:
                                        value
                                })
                            );
                        }}
                    />
                </label>

                <div className="web-input-row">
                    <label>
                        <span>Saída do ar</span>
                        <select
                            value={
                                draft.timingMode
                            }
                            onChange={(event) => {
                                const value =
                                    event.currentTarget
                                        .value as WebInput["timingMode"];
                                setDraft(
                                    (current) => ({
                                        ...current,
                                        timingMode:
                                            value
                                    })
                                );
                            }}
                        >
                            <option value="duration">
                                Por duração
                            </option>
                            <option value="clock">
                                Por horário
                            </option>
                        </select>
                    </label>

                    {draft.timingMode ===
                    "duration" ? (
                        <label>
                            <span>Duração (segundos)</span>
                            <input
                                type="number"
                                min={1}
                                max={86400}
                                value={
                                    draft.durationSeconds
                                }
                                onChange={(event) => {
                                    const value =
                                        Math.max(
                                            1,
                                            Number(
                                                event.currentTarget.value
                                            ) || 1
                                        );
                                    setDraft(
                                        (current) => ({
                                            ...current,
                                            durationSeconds:
                                                value
                                        })
                                    );
                                }}
                            />
                        </label>
                    ) : (
                        <label>
                            <span>Horário de saída</span>
                            <input
                                type="time"
                                step={1}
                                value={
                                    draft.endTime
                                }
                                onChange={(event) => {
                                    const value =
                                        event.currentTarget.value;
                                    setDraft(
                                        (current) => ({
                                            ...current,
                                            endTime:
                                                value
                                        })
                                    );
                                }}
                            />
                        </label>
                    )}
                </div>

                <div className="web-input-duration-preview">
                    Se entrar agora, sai em{" "}
                    <strong>
                        {formatDuration(
                            previewDuration
                        )}
                    </strong>
                </div>

                <div className="web-input-actions">
                    {editingId && (
                        <button
                            type="button"
                            className="secondary-button"
                            onClick={
                                clear
                            }
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        type="button"
                        className="primary-button"
                        disabled={saving}
                        onClick={() =>
                            void save()
                        }
                    >
                        {saving
                            ? "Salvando..."
                            : editingId
                              ? "Atualizar input"
                              : "Salvar input"}
                    </button>
                </div>
            </div>

            {status && (
                <div className="library-message">
                    {status}
                </div>
            )}

            <div className="web-input-list">
                {inputs.length === 0 ? (
                    <div className="empty-state">
                        Nenhum input cadastrado.
                    </div>
                ) : (
                    inputs.map(
                        (input) => (
                            <article
                                className="web-input-item"
                                key={
                                    input.id
                                }
                                draggable
                                title="Arraste para a Timeline ou dê dois cliques para adicionar"
                                onDoubleClick={() =>
                                    addToTimeline(
                                        input
                                    )
                                }
                                onDragStart={(event) =>
                                    startInputDrag(
                                        event,
                                        input
                                    )
                                }
                            >
                                <div>
                                    <strong>
                                        {
                                            input.name
                                        }
                                    </strong>
                                    <span>
                                        {
                                            input.url
                                        }
                                    </span>
                                    <small>
                                        {input.protocol.toUpperCase()}
                                        {" · "}
                                        {input.timingMode ===
                                        "clock"
                                            ? `até ${input.endTime}`
                                            : formatDuration(
                                                  input.durationSeconds
                                              )}
                                        {" · "}
                                        {
                                            input.fitMode
                                        }
                                        {" · "}
                                        motor {
                                            (input.engine ?? "auto").toUpperCase()
                                        }
                                    </small>
                                </div>

                                <button
                                    type="button"
                                    className="secondary-button"
                                    onDoubleClick={(event) =>
                                        event.stopPropagation()
                                    }
                                    onClick={() =>
                                        edit(
                                            input
                                        )
                                    }
                                >
                                    Editar
                                </button>

                                <button
                                    type="button"
                                    className="secondary-button danger-secondary"
                                    onDoubleClick={(event) =>
                                        event.stopPropagation()
                                    }
                                    onClick={() =>
                                        void remove(
                                            input.id
                                        )
                                    }
                                >
                                    Remover
                                </button>

                                <button
                                    type="button"
                                    className="primary-button"
                                    onDoubleClick={(event) =>
                                        event.stopPropagation()
                                    }
                                    onClick={() =>
                                        addToTimeline(
                                            input
                                        )
                                    }
                                >
                                    + Timeline
                                </button>
                            </article>
                        )
                    )
                )}
            </div>
        </div>
    );
}

export default function WebInputsPanel(
    props: Props
) {
    return (
        <WebInputsErrorBoundary>
            <WebInputsContent
                {...props}
            />
        </WebInputsErrorBoundary>
    );
}
