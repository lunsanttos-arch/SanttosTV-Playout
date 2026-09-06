import {
    useEffect,
    useState
} from "react";

import "./broadcast-settings.css";
import WatermarkSettingsTab from "./WatermarkSettingsTab";

type SettingsTab =
    | "output"
    | "watermark"
    | "hashtag";

interface HashtagStyle {
    fontFamily: string;
    fontSize: number;
    color: string;
    opacity: number;
    x: number;
    y: number;
    bold: boolean;
    outlineWidth: number;
    outlineColor: string;
    outlineOpacity: number;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowOpacity: number;
    shadowX: number;
    shadowY: number;
}

interface OutputSettings {
    resolution: string;
    fps: string;
    scanMode: "progressive" | "interlaced";
    aspectRatio: "16:9" | "4:3";
    pixelFormat: "yuv420p" | "yuv422p" | "bgra";
    audio: {
        sampleRate: number;
        channels: number;
        bitrateKbps: number;
        codec: "aac" | "pcm_s16le";
    };
    ndi: {
        enabled: boolean;
        name: string;
    };
    srt: {
        enabled: boolean;
        mode: "caller" | "listener" | "rendezvous";
        host: string;
        port: number;
        latencyMs: number;
        passphrase: string;
        streamId: string;
        videoCodec: "h264" | "hevc";
        videoBitrateKbps: number;
        maxBitrateKbps: number;
        gopSeconds: number;
        preset: string;
        audioCodec: "aac";
        audioBitrateKbps: number;
    };
}

interface Props {
    hashtagStyle: HashtagStyle;
    onSaveHashtag: (
        style: HashtagStyle
    ) => Promise<void>;
}

const DEFAULT_OUTPUT: OutputSettings = {
    resolution: "1920x1080",
    fps: "29.97",
    scanMode: "progressive",
    aspectRatio: "16:9",
    pixelFormat: "yuv420p",
    audio: {
        sampleRate: 48000,
        channels: 2,
        bitrateKbps: 192,
        codec: "aac"
    },
    ndi: {
        enabled: true,
        name: "Santtos TV - PROGRAM"
    },
    srt: {
        enabled: false,
        mode: "caller",
        host: "127.0.0.1",
        port: 9000,
        latencyMs: 120,
        passphrase: "",
        streamId: "",
        videoCodec: "h264",
        videoBitrateKbps: 8000,
        maxBitrateKbps: 10000,
        gopSeconds: 2,
        preset: "veryfast",
        audioCodec: "aac",
        audioBitrateKbps: 192
    }
};

export default function BroadcastSettingsPanel({
    hashtagStyle,
    onSaveHashtag
}: Props) {
    const [tab, setTab] =
        useState<SettingsTab>("output");
    const [output, setOutput] =
        useState<OutputSettings>(DEFAULT_OUTPUT);
    const [hashtag, setHashtag] =
        useState<HashtagStyle>(hashtagStyle);
    const [status, setStatus] =
        useState("");
    const [isSaving, setIsSaving] =
        useState(false);

    useEffect(() => {
        setHashtag(hashtagStyle);
    }, [hashtagStyle]);

    useEffect(() => {
        const api = (window as any).santtosAPI;

        api.getSettings()
            .then((settings: any) => {
                setOutput(
                    settings.output ??
                        DEFAULT_OUTPUT
                );
            })
            .catch((error: unknown) => {
                console.error(error);
                setStatus(
                    "Não foi possível carregar o perfil de saída."
                );
            });
    }, []);

    function patchOutput(
        values: Partial<OutputSettings>
    ) {
        setOutput((current) => ({
            ...current,
            ...values
        }));
        setStatus("");
    }

    function patchAudio(
        values: Partial<OutputSettings["audio"]>
    ) {
        setOutput((current) => ({
            ...current,
            audio: {
                ...current.audio,
                ...values
            }
        }));
        setStatus("");
    }

    function patchNdi(
        values: Partial<OutputSettings["ndi"]>
    ) {
        setOutput((current) => ({
            ...current,
            ndi: {
                ...current.ndi,
                ...values
            }
        }));
        setStatus("");
    }

    function patchSrt(
        values: Partial<OutputSettings["srt"]>
    ) {
        setOutput((current) => ({
            ...current,
            srt: {
                ...current.srt,
                ...values
            }
        }));
        setStatus("");
    }

    function patchHashtag(
        values: Partial<HashtagStyle>
    ) {
        setHashtag((current) => ({
            ...current,
            ...values
        }));
        setStatus("");
    }

    async function saveOutput() {
        setIsSaving(true);

        try {
            const api = (window as any).santtosAPI;
            const result =
                await api.saveOutputSettings(
                    output
                );

            if (!result?.ok) {
                throw new Error(
                    "Falha ao salvar perfil de saída."
                );
            }

            setOutput(result.output);
            setStatus(
                "Perfil de saída salvo. O NDI atual permanece em 1080p29.97 até a migração do sender dinâmico."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível salvar o perfil de saída."
            );
        } finally {
            setIsSaving(false);
        }
    }

    async function saveHashtag() {
        setIsSaving(true);

        try {
            await onSaveHashtag(hashtag);
            setStatus(
                "Configuração do GC salva e aplicada ao PROGRAM."
            );
        } catch (error) {
            console.error(error);
            setStatus(
                "Não foi possível salvar o GC."
            );
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <section className="panel broadcast-settings-panel">
            <div className="broadcast-settings-header">
                <div>
                    <div className="panel-title">
                        CONFIGURAÇÕES
                    </div>
                    <h1>Saída e transporte</h1>
                    <p>
                        Perfil técnico do PROGRAM, áudio, NDI e preparação da saída SRT.
                    </p>
                </div>

                <div className="settings-tabs">
                    <button
                        type="button"
                        className={
                            tab === "output"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("output")
                        }
                    >
                        Saída / Transporte
                    </button>
                    <button
                        type="button"
                        className={
                            tab === "watermark"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("watermark")
                        }
                    >
                        Marca d'água
                    </button>
                    <button
                        type="button"
                        className={
                            tab === "hashtag"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("hashtag")
                        }
                    >
                        Hashtag / GC
                    </button>
                </div>
            </div>

            {tab === "output" ? (
                <OutputTab
                    output={output}
                    patchOutput={patchOutput}
                    patchAudio={patchAudio}
                    patchNdi={patchNdi}
                    patchSrt={patchSrt}
                />
            ) : tab === "watermark" ? (
                <WatermarkSettingsTab />
            ) : (
                <HashtagTab
                    style={hashtag}
                    patch={patchHashtag}
                />
            )}

            <div className="broadcast-settings-footer">
                <span>
                    {status ||
                        "Alterações só entram depois de salvar."}
                </span>
                <button
                    type="button"
                    className="primary-button"
                    disabled={isSaving}
                    onClick={
                        tab === "output"
                            ? saveOutput
                            : tab === "hashtag"
                              ? saveHashtag
                              : undefined
                    }
                    style={
                        tab === "watermark"
                            ? { display: "none" }
                            : undefined
                    }
                >
                    {isSaving
                        ? "Salvando..."
                        : "Aplicar e salvar"}
                </button>
            </div>
        </section>
    );
}

function OutputTab({
    output,
    patchOutput,
    patchAudio,
    patchNdi,
    patchSrt
}: {
    output: OutputSettings;
    patchOutput: (
        values: Partial<OutputSettings>
    ) => void;
    patchAudio: (
        values: Partial<OutputSettings["audio"]>
    ) => void;
    patchNdi: (
        values: Partial<OutputSettings["ndi"]>
    ) => void;
    patchSrt: (
        values: Partial<OutputSettings["srt"]>
    ) => void;
}) {
    return (
        <div className="broadcast-settings-grid">
            <SettingsCard
                title="Formato do PROGRAM"
                description="Presets comuns de playout e contribuição."
            >
                <SelectField
                    label="Resolução"
                    value={output.resolution}
                    options={[
                        ["3840x2160", "UHD 2160p"],
                        ["1920x1080", "Full HD 1080"],
                        ["1280x720", "HD 720"],
                        ["720x576", "SD PAL 576"],
                        ["720x480", "SD NTSC 480"]
                    ]}
                    onChange={(value) =>
                        patchOutput({
                            resolution: value
                        })
                    }
                />

                <SelectField
                    label="Frames por segundo"
                    value={output.fps}
                    options={[
                        ["23.976", "23.976"],
                        ["24", "24"],
                        ["25", "25"],
                        ["29.97", "29.97"],
                        ["30", "30"],
                        ["50", "50"],
                        ["59.94", "59.94"],
                        ["60", "60"]
                    ]}
                    onChange={(value) =>
                        patchOutput({ fps: value })
                    }
                />

                <SelectField
                    label="Varredura"
                    value={output.scanMode}
                    options={[
                        ["progressive", "Progressivo"],
                        ["interlaced", "Entrelaçado"]
                    ]}
                    onChange={(value) =>
                        patchOutput({
                            scanMode:
                                value as OutputSettings["scanMode"]
                        })
                    }
                />

                <SelectField
                    label="Aspect ratio"
                    value={output.aspectRatio}
                    options={[
                        ["16:9", "16:9"],
                        ["4:3", "4:3"]
                    ]}
                    onChange={(value) =>
                        patchOutput({
                            aspectRatio:
                                value as OutputSettings["aspectRatio"]
                        })
                    }
                />

                <SelectField
                    label="Pixel format"
                    value={output.pixelFormat}
                    options={[
                        ["yuv420p", "YUV 4:2:0"],
                        ["yuv422p", "YUV 4:2:2"],
                        ["bgra", "BGRA 8-bit"]
                    ]}
                    onChange={(value) =>
                        patchOutput({
                            pixelFormat:
                                value as OutputSettings["pixelFormat"]
                        })
                    }
                />

                <div className="settings-info warning">
                    O sender NDI compilado hoje continua em 1920×1080 29.97p BGRA. Estes valores já ficam salvos para a próxima versão dinâmica e para o SRT.
                </div>
            </SettingsCard>

            <SettingsCard
                title="Áudio"
                description="Padrões usuais para broadcast e streaming."
            >
                <SelectField
                    label="Sample rate"
                    value={String(
                        output.audio.sampleRate
                    )}
                    options={[
                        ["48000", "48 kHz (broadcast)"],
                        ["44100", "44.1 kHz"]
                    ]}
                    onChange={(value) =>
                        patchAudio({
                            sampleRate: Number(value)
                        })
                    }
                />

                <SelectField
                    label="Canais"
                    value={String(
                        output.audio.channels
                    )}
                    options={[
                        ["2", "Stereo 2.0"],
                        ["1", "Mono"]
                    ]}
                    onChange={(value) =>
                        patchAudio({
                            channels: Number(value)
                        })
                    }
                />

                <SelectField
                    label="Codec"
                    value={output.audio.codec}
                    options={[
                        ["aac", "AAC"],
                        ["pcm_s16le", "PCM 16-bit"]
                    ]}
                    onChange={(value) =>
                        patchAudio({
                            codec:
                                value as OutputSettings["audio"]["codec"]
                        })
                    }
                />

                <SelectField
                    label="Bitrate AAC"
                    value={String(
                        output.audio.bitrateKbps
                    )}
                    options={[
                        ["96", "96 kbps"],
                        ["128", "128 kbps"],
                        ["160", "160 kbps"],
                        ["192", "192 kbps"],
                        ["256", "256 kbps"],
                        ["320", "320 kbps"]
                    ]}
                    disabled={
                        output.audio.codec !== "aac"
                    }
                    onChange={(value) =>
                        patchAudio({
                            bitrateKbps:
                                Number(value)
                        })
                    }
                />

                <div className="settings-info">
                    Recomendação padrão: 48 kHz, stereo, AAC 192 kbps para SRT. Para NDI nativo, áudio PCM será adicionado no engine.
                </div>
            </SettingsCard>

            <SettingsCard
                title="NDI"
                description="Saída de rede local do PROGRAM."
            >
                <ToggleField
                    label="Ativar NDI"
                    checked={output.ndi.enabled}
                    onChange={(enabled) =>
                        patchNdi({ enabled })
                    }
                />

                <TextField
                    label="Nome da fonte"
                    value={output.ndi.name}
                    onChange={(name) =>
                        patchNdi({ name })
                    }
                />

                <div className="output-state online">
                    <strong>Engine atual</strong>
                    <span>
                        1920×1080 · 29.97p · BGRA
                    </span>
                </div>
            </SettingsCard>

            <SettingsCard
                title="SRT"
                description="Preparação da contribuição/saída remota."
                badge="EM PREPARAÇÃO"
            >
                <ToggleField
                    label="Habilitar configuração SRT"
                    checked={output.srt.enabled}
                    onChange={(enabled) =>
                        patchSrt({ enabled })
                    }
                />

                <SelectField
                    label="Modo"
                    value={output.srt.mode}
                    options={[
                        ["caller", "Caller"],
                        ["listener", "Listener"],
                        ["rendezvous", "Rendezvous"]
                    ]}
                    onChange={(value) =>
                        patchSrt({
                            mode:
                                value as OutputSettings["srt"]["mode"]
                        })
                    }
                />

                <div className="settings-two-columns">
                    <TextField
                        label="Host / IP"
                        value={output.srt.host}
                        onChange={(host) =>
                            patchSrt({ host })
                        }
                    />
                    <NumberSetting
                        label="Porta"
                        value={output.srt.port}
                        min={1}
                        max={65535}
                        onChange={(port) =>
                            patchSrt({ port })
                        }
                    />
                </div>

                <NumberSetting
                    label="Latency"
                    value={output.srt.latencyMs}
                    min={20}
                    max={8000}
                    suffix="ms"
                    onChange={(latencyMs) =>
                        patchSrt({ latencyMs })
                    }
                />

                <TextField
                    label="Stream ID"
                    value={output.srt.streamId}
                    placeholder="Opcional"
                    onChange={(streamId) =>
                        patchSrt({ streamId })
                    }
                />

                <TextField
                    label="Passphrase"
                    value={output.srt.passphrase}
                    placeholder="Opcional · 10 a 79 caracteres"
                    password
                    onChange={(passphrase) =>
                        patchSrt({ passphrase })
                    }
                />

                <div className="settings-divider" />

                <SelectField
                    label="Codec de vídeo"
                    value={output.srt.videoCodec}
                    options={[
                        ["h264", "H.264 / AVC"],
                        ["hevc", "H.265 / HEVC"]
                    ]}
                    onChange={(value) =>
                        patchSrt({
                            videoCodec:
                                value as OutputSettings["srt"]["videoCodec"]
                        })
                    }
                />

                <div className="settings-two-columns">
                    <NumberSetting
                        label="Bitrate vídeo"
                        value={
                            output.srt.videoBitrateKbps
                        }
                        min={500}
                        max={100000}
                        suffix="kbps"
                        onChange={(videoBitrateKbps) =>
                            patchSrt({
                                videoBitrateKbps
                            })
                        }
                    />
                    <NumberSetting
                        label="Max bitrate"
                        value={
                            output.srt.maxBitrateKbps
                        }
                        min={500}
                        max={120000}
                        suffix="kbps"
                        onChange={(maxBitrateKbps) =>
                            patchSrt({
                                maxBitrateKbps
                            })
                        }
                    />
                </div>

                <div className="settings-two-columns">
                    <NumberSetting
                        label="GOP"
                        value={output.srt.gopSeconds}
                        min={0.5}
                        max={10}
                        step={0.5}
                        suffix="s"
                        onChange={(gopSeconds) =>
                            patchSrt({ gopSeconds })
                        }
                    />
                    <SelectField
                        label="Preset"
                        value={output.srt.preset}
                        options={[
                            ["ultrafast", "ultrafast"],
                            ["superfast", "superfast"],
                            ["veryfast", "veryfast"],
                            ["faster", "faster"],
                            ["fast", "fast"],
                            ["medium", "medium"]
                        ]}
                        onChange={(preset) =>
                            patchSrt({ preset })
                        }
                    />
                </div>

                <SelectField
                    label="Áudio SRT"
                    value={String(
                        output.srt.audioBitrateKbps
                    )}
                    options={[
                        ["96", "AAC 96 kbps"],
                        ["128", "AAC 128 kbps"],
                        ["160", "AAC 160 kbps"],
                        ["192", "AAC 192 kbps"],
                        ["256", "AAC 256 kbps"],
                        ["320", "AAC 320 kbps"]
                    ]}
                    onChange={(value) =>
                        patchSrt({
                            audioBitrateKbps:
                                Number(value)
                        })
                    }
                />

                <div className="settings-info warning">
                    Nesta versão o SRT ainda não transmite. A configuração já fica persistida para o próximo passo: encoder FFmpeg + MPEG-TS + SRT, com áudio e vídeo do mesmo PROGRAM.
                </div>
            </SettingsCard>
        </div>
    );
}

function HashtagTab({
    style,
    patch
}: {
    style: HashtagStyle;
    patch: (
        values: Partial<HashtagStyle>
    ) => void;
}) {
    return (
        <div className="broadcast-settings-grid hashtag-config-grid">
            <SettingsCard title="Tipografia">
                <SelectField
                    label="Fonte"
                    value={style.fontFamily}
                    options={[
                        ["Arial", "Arial"],
                        ["Segoe UI", "Segoe UI"],
                        ["Tahoma", "Tahoma"],
                        ["Verdana", "Verdana"],
                        ["Calibri", "Calibri"]
                    ]}
                    onChange={(fontFamily) =>
                        patch({ fontFamily })
                    }
                />
                <NumberSetting
                    label="Tamanho"
                    value={style.fontSize}
                    min={10}
                    max={160}
                    suffix="px"
                    onChange={(fontSize) =>
                        patch({ fontSize })
                    }
                />
                <ToggleField
                    label="Negrito"
                    checked={style.bold}
                    onChange={(bold) =>
                        patch({ bold })
                    }
                />
            </SettingsCard>

            <SettingsCard title="Posição e aparência">
                <div className="settings-two-columns">
                    <NumberSetting
                        label="X"
                        value={style.x}
                        min={0}
                        max={1920}
                        suffix="px"
                        onChange={(x) => patch({ x })}
                    />
                    <NumberSetting
                        label="Y"
                        value={style.y}
                        min={0}
                        max={1080}
                        suffix="px"
                        onChange={(y) => patch({ y })}
                    />
                </div>
                <ColorSetting
                    label="Cor"
                    value={style.color}
                    onChange={(color) =>
                        patch({ color })
                    }
                />
                <RangeSetting
                    label="Opacidade"
                    value={style.opacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(opacity) =>
                        patch({ opacity })
                    }
                />
                <NumberSetting
                    label="Contorno"
                    value={style.outlineWidth}
                    min={0}
                    max={12}
                    suffix="px"
                    onChange={(outlineWidth) =>
                        patch({ outlineWidth })
                    }
                />
                <ColorSetting
                    label="Cor do contorno"
                    value={style.outlineColor}
                    onChange={(outlineColor) =>
                        patch({ outlineColor })
                    }
                />
                <ToggleField
                    label="Sombra"
                    checked={style.shadowEnabled}
                    onChange={(shadowEnabled) =>
                        patch({ shadowEnabled })
                    }
                />
            </SettingsCard>

            <SettingsCard
                title="Preview 1920×1080"
                className="hashtag-preview-card"
            >
                <div className="broadcast-hashtag-preview">
                    <span
                        style={{
                            position: "absolute",
                            left: `${(style.x / 1920) * 100}%`,
                            top: `${(style.y / 1080) * 100}%`,
                            fontFamily: style.fontFamily,
                            fontSize: `${Math.max(
                                8,
                                style.fontSize * 0.35
                            )}px`,
                            fontWeight:
                                style.bold ? 700 : 400,
                            color: hexToRgba(
                                style.color,
                                style.opacity
                            ),
                            WebkitTextStroke:
                                style.outlineWidth > 0
                                    ? `${Math.max(
                                          0.3,
                                          style.outlineWidth * 0.35
                                      )}px ${hexToRgba(
                                          style.outlineColor,
                                          style.outlineOpacity
                                      )}`
                                    : undefined,
                            textShadow:
                                style.shadowEnabled
                                    ? `${style.shadowX * 0.35}px ${style.shadowY * 0.35}px 2px ${hexToRgba(
                                          style.shadowColor,
                                          style.shadowOpacity
                                      )}`
                                    : "none"
                        }}
                    >
                        #RondaPopular
                    </span>
                </div>
                <div className="settings-info">
                    O GC é aplicado depois do scale/pad do vídeo, então permanece fixo no canvas de saída mesmo com arquivos 4:3 ou verticais.
                </div>
            </SettingsCard>
        </div>
    );
}

function SettingsCard({
    title,
    description,
    badge,
    className = "",
    children
}: {
    title: string;
    description?: string;
    badge?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`broadcast-settings-card ${className}`}>
            <div className="broadcast-card-header">
                <div>
                    <h2>{title}</h2>
                    {description && (
                        <p>{description}</p>
                    )}
                </div>
                {badge && (
                    <span className="settings-badge">
                        {badge}
                    </span>
                )}
            </div>
            <div className="broadcast-card-fields">
                {children}
            </div>
        </div>
    );
}

function SelectField({
    label,
    value,
    options,
    disabled = false,
    onChange
}: {
    label: string;
    value: string;
    options: Array<[string, string]>;
    disabled?: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <label className="broadcast-setting-field">
            <span>{label}</span>
            <select
                value={value}
                disabled={disabled}
                onChange={(event) =>
                    onChange(
                        event.currentTarget.value
                    )
                }
            >
                {options.map(([key, name]) => (
                    <option
                        key={key}
                        value={key}
                    >
                        {name}
                    </option>
                ))}
            </select>
        </label>
    );
}

function TextField({
    label,
    value,
    placeholder,
    password = false,
    onChange
}: {
    label: string;
    value: string;
    placeholder?: string;
    password?: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <label className="broadcast-setting-field">
            <span>{label}</span>
            <input
                type={password ? "password" : "text"}
                value={value}
                placeholder={placeholder}
                onChange={(event) =>
                    onChange(
                        event.currentTarget.value
                    )
                }
            />
        </label>
    );
}

function NumberSetting({
    label,
    value,
    min,
    max,
    step = 1,
    suffix,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    suffix?: string;
    onChange: (value: number) => void;
}) {
    return (
        <label className="broadcast-setting-field">
            <span>{label}</span>
            <div className="broadcast-number-field">
                <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(event) =>
                        onChange(
                            Number(
                                event.currentTarget.value
                            )
                        )
                    }
                />
                {suffix && <small>{suffix}</small>}
            </div>
        </label>
    );
}

function ToggleField({
    label,
    checked,
    onChange
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="broadcast-toggle-field">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                    onChange(
                        event.currentTarget.checked
                    )
                }
            />
            <span>{label}</span>
        </label>
    );
}

function ColorSetting({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="broadcast-setting-field">
            <span>{label}</span>
            <div className="broadcast-color-field">
                <input
                    type="color"
                    value={value}
                    onChange={(event) =>
                        onChange(
                            event.currentTarget.value
                        )
                    }
                />
                <code>{value.toUpperCase()}</code>
            </div>
        </label>
    );
}

function RangeSetting({
    label,
    value,
    min,
    max,
    step,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="broadcast-setting-field">
            <span>
                {label} · {Math.round(value * 100)}%
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) =>
                    onChange(
                        Number(
                            event.currentTarget.value
                        )
                    )
                }
            />
        </label>
    );
}

function hexToRgba(
    hex: string,
    opacity: number
) {
    const clean = hex.replace("#", "");
    const red = parseInt(clean.slice(0, 2), 16);
    const green = parseInt(clean.slice(2, 4), 16);
    const blue = parseInt(clean.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}
