import {
    useEffect,
    useState
} from "react";

import "./watermark-settings.css";

interface WatermarkStyle {
    filePath: string;
    widthPx: number;
    x: number;
    y: number;
    opacity: number;
    fadeMs: number;
}

const DEFAULT_WATERMARK: WatermarkStyle = {
    filePath: "",
    widthPx: 180,
    x: 1680,
    y: 40,
    opacity: 0.82,
    fadeMs: 200
};

function clampNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number
) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(
        max,
        Math.max(min, numberValue)
    );
}

function normalizeWatermarkStyle(
    value: unknown
): WatermarkStyle {
    const source =
        value && typeof value === "object"
            ? value as Partial<WatermarkStyle>
            : {};

    return {
        filePath:
            typeof source.filePath === "string"
                ? source.filePath
                : "",
        widthPx: clampNumber(
            source.widthPx,
            DEFAULT_WATERMARK.widthPx,
            24,
            960
        ),
        x: clampNumber(
            source.x,
            DEFAULT_WATERMARK.x,
            0,
            1920
        ),
        y: clampNumber(
            source.y,
            DEFAULT_WATERMARK.y,
            0,
            1080
        ),
        opacity: clampNumber(
            source.opacity,
            DEFAULT_WATERMARK.opacity,
            0,
            1
        ),
        fadeMs: clampNumber(
            source.fadeMs,
            DEFAULT_WATERMARK.fadeMs,
            0,
            2000
        )
    };
}

export default function WatermarkSettingsTab() {
    const [draft, setDraft] =
        useState<WatermarkStyle>(
            DEFAULT_WATERMARK
        );
    const [status, setStatus] =
        useState("");
    const [isSaving, setIsSaving] =
        useState(false);
    const [previewUrl, setPreviewUrl] =
        useState("");

    useEffect(() => {
        const api = (window as any).santtosAPI;

        if (!api?.getSettings) {
            setStatus(
                "API de configurações indisponível."
            );
            return;
        }

        api.getSettings()
            .then((settings: any) => {
                setDraft(
                    normalizeWatermarkStyle(
                        settings?.watermarkStyle
                    )
                );
            })
            .catch((error: unknown) => {
                console.error(error);
                setDraft(DEFAULT_WATERMARK);
                setStatus(
                    "Não foi possível carregar a marca d'água. Os valores padrão foram restaurados nesta tela."
                );
            });
    }, []);

    useEffect(() => {
        if (!draft.filePath) {
            setPreviewUrl("");
            return;
        }

        try {
            const api = (window as any).santtosAPI;

            if (!api?.getMediaFileUrl) {
                setPreviewUrl("");
                setStatus(
                    "Preview indisponível, mas a configuração pode ser alterada normalmente."
                );
                return;
            }

            const url = api.getMediaFileUrl(
                draft.filePath
            );

            setPreviewUrl(
                typeof url === "string"
                    ? url
                    : ""
            );
        } catch (error) {
            console.error(
                "Falha ao criar URL do preview da marca d'água:",
                error
            );
            setPreviewUrl("");
            setStatus(
                "A marca d'água salva anteriormente tem um caminho inválido. Selecione a imagem novamente."
            );
        }
    }, [draft.filePath]);

    function patch(
        values: Partial<WatermarkStyle>
    ) {
        setDraft((current) =>
            normalizeWatermarkStyle({
                ...current,
                ...values
            })
        );
        setStatus("");
    }

    async function chooseFile() {
        try {
            const api = (window as any).santtosAPI;

            if (!api?.selectWatermark) {
                setStatus(
                    "Seletor de marca d'água indisponível."
                );
                return;
            }

            const result =
                await api.selectWatermark();

            if (!result?.ok) {
                if (!result?.canceled) {
                    setStatus(
                        result?.error ??
                            "Não foi possível selecionar a imagem."
                    );
                }
                return;
            }

            patch({
                filePath:
                    typeof result.filePath === "string"
                        ? result.filePath
                        : ""
            });
            setStatus(
                `Imagem validada${
                    result.image
                        ? ` (${result.image.width}x${result.image.height})`
                        : ""
                }. Ajuste tamanho e posição e salve.`
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível selecionar a imagem."
            );
        }
    }

    async function save() {
        setIsSaving(true);

        try {
            const api = (window as any).santtosAPI;

            if (!api?.saveWatermarkStyle) {
                throw new Error(
                    "API de salvamento indisponível."
                );
            }

            const result =
                await api.saveWatermarkStyle(
                    normalizeWatermarkStyle(draft)
                );

            if (!result?.ok) {
                throw new Error(
                    result?.error ??
                        "Falha ao salvar marca d'água."
                );
            }

            setDraft(
                normalizeWatermarkStyle(
                    result.watermarkStyle
                )
            );
            setStatus(
                "Marca d'água salva. A timeline decide em quais vídeos ela entra."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Não foi possível salvar a marca d'água."
            );
        } finally {
            setIsSaving(false);
        }
    }

    const previewStyle = {
        left: `${(draft.x / 1920) * 100}%`,
        top: `${(draft.y / 1080) * 100}%`,
        width: `${(draft.widthPx / 1920) * 100}%`,
        opacity: draft.opacity
    };

    return (
        <div className="watermark-settings-layout">
            <section className="watermark-settings-card">
                <div className="watermark-settings-title">
                    <div>
                        <strong>Marca d'água do PROGRAM</strong>
                        <span>
                            PNG com transparência é o formato recomendado.
                        </span>
                    </div>

                    <button
                        type="button"
                        className="primary-button"
                        onClick={chooseFile}
                    >
                        Selecionar imagem
                    </button>
                </div>

                <label className="watermark-field">
                    <span>Arquivo</span>
                    <input
                        type="text"
                        value={draft.filePath}
                        readOnly
                        placeholder="Nenhuma marca d'água selecionada"
                    />
                </label>

                <div className="watermark-grid-fields">
                    <NumberField
                        label="Largura no Full HD"
                        value={draft.widthPx}
                        min={24}
                        max={960}
                        suffix="px"
                        onChange={(widthPx) =>
                            patch({ widthPx })
                        }
                    />
                    <NumberField
                        label="Posição X"
                        value={draft.x}
                        min={0}
                        max={1920}
                        suffix="px"
                        onChange={(x) =>
                            patch({ x })
                        }
                    />
                    <NumberField
                        label="Posição Y"
                        value={draft.y}
                        min={0}
                        max={1080}
                        suffix="px"
                        onChange={(y) =>
                            patch({ y })
                        }
                    />
                    <NumberField
                        label="Fade"
                        value={draft.fadeMs}
                        min={0}
                        max={2000}
                        suffix="ms"
                        onChange={(fadeMs) =>
                            patch({ fadeMs })
                        }
                    />
                </div>

                <label className="watermark-field">
                    <span>
                        Opacidade
                        <strong>
                            {Math.round(
                                draft.opacity * 100
                            )}%
                        </strong>
                    </span>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={draft.opacity}
                        onChange={(event) =>
                            patch({
                                opacity: Number(
                                    event.currentTarget.value
                                )
                            })
                        }
                    />
                </label>

                <div className="watermark-note">
                    O fade é inteligente: se o próximo item também estiver marcado com marca d'água, ela permanece no ar sem fade-out e sem novo fade-in.
                </div>

                <div className="watermark-settings-actions">
                    <button
                        type="button"
                        onClick={() =>
                            setDraft({
                                ...DEFAULT_WATERMARK,
                                filePath: draft.filePath
                            })
                        }
                    >
                        Restaurar tamanho/posição
                    </button>
                    <button
                        type="button"
                        className="primary-button"
                        disabled={isSaving}
                        onClick={save}
                    >
                        {isSaving
                            ? "Salvando..."
                            : "Aplicar e salvar"}
                    </button>
                </div>

                {status && (
                    <div className="watermark-status">
                        {status}
                    </div>
                )}
            </section>

            <section className="watermark-preview-card">
                <div className="panel-title">
                    PREVIEW DO OUTPUT 1920×1080
                </div>
                <div className="watermark-output-preview">
                    <div className="watermark-safe-area" />
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            style={previewStyle}
                            alt="Preview da marca d'água"
                            onError={() => {
                                setPreviewUrl("");
                                setStatus(
                                    "O arquivo salvo não pôde ser carregado no preview. Selecione a marca d'água novamente."
                                );
                            }}
                        />
                    ) : (
                        <div className="watermark-preview-empty">
                            {draft.filePath
                                ? "Preview indisponível — selecione a imagem novamente"
                                : "Selecione a imagem da TV"}
                        </div>
                    )}
                </div>
                <div className="watermark-preview-summary">
                    <strong>
                        {draft.widthPx}px de largura
                    </strong>
                    <span>
                        X {draft.x}px · Y {draft.y}px · Fade {draft.fadeMs}ms
                    </span>
                </div>
            </section>
        </div>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    suffix,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    suffix: string;
    onChange: (value: number) => void;
}) {
    return (
        <label className="watermark-field">
            <span>{label}</span>
            <div className="watermark-number-input">
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(event) => {
                        const number = Number(
                            event.currentTarget.value
                        );
                        if (Number.isFinite(number)) {
                            onChange(
                                Math.min(
                                    max,
                                    Math.max(min, number)
                                )
                            );
                        }
                    }}
                />
                <small>{suffix}</small>
            </div>
        </label>
    );
}
