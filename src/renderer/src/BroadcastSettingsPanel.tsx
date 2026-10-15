import {
    useEffect,
    useState
} from "react";

import "./broadcast-settings.css";
import WatermarkSettingsTab from "./WatermarkSettingsTab";
import LibraryFolderSettingsTab from "./LibraryFolderSettingsTab";
import ExhibitionSettingsTab from "./ExhibitionSettingsTab";
import OperationSettingsTab from "./OperationSettingsTab";
import DataBackupSettingsTab from "./DataBackupSettingsTab";
import CacheSettingsTab from "./CacheSettingsTab";
import ReportingSettingsTab from "./ReportingSettingsTab";
import { DEFAULT_EXHIBITION_STYLE } from "./exhibition";
import type { ExhibitionStyle } from "./exhibition";

type SettingsTab =
    | "output"
    | "library"
    | "cache"
    | "watermark"
    | "exhibition"
    | "hashtag"
    | "reporting"
    | "backup"
    | "operation";

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
    omt: {
        enabled: boolean;
        name: string;
        quality: "default" | "low" | "medium" | "high";
    };
    rtmp: { enabled: boolean; url: string };
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
    exhibitionStyle: ExhibitionStyle;
    onSaveExhibition: (style: ExhibitionStyle) => Promise<void>;
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
    omt: {
        enabled: false,
        name: "SanTTos Playout - PROGRAM",
        quality: "high"
    },
    rtmp: { enabled: false, url: "" },
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
    onSaveHashtag,
    exhibitionStyle,
    onSaveExhibition
}: Props) {
    const [tab, setTab] =
        useState<SettingsTab>("output");
    const [output, setOutput] =
        useState<OutputSettings>(DEFAULT_OUTPUT);
    const [hashtag, setHashtag] =
        useState<HashtagStyle>(hashtagStyle);
    const [exhibition, setExhibition] = useState<ExhibitionStyle>(exhibitionStyle);
    const [watermarkPosition, setWatermarkPosition] = useState({
        filePath: "", x: 1680, y: 40, widthPx: 180, opacity: 0.82
    });
    const [status, setStatus] =
        useState("");
    const [isSaving, setIsSaving] =
        useState(false);

    useEffect(() => {
        setHashtag(hashtagStyle);
    }, [hashtagStyle]);
    useEffect(() => {
        setExhibition(exhibitionStyle);
    }, [exhibitionStyle]);

    useEffect(() => {
        const api = (window as any).santtosAPI;

        api.getSettings()
            .then((settings: any) => {
                setOutput(
                    settings.output ??
                        DEFAULT_OUTPUT
                );
                setWatermarkPosition(settings.watermarkStyle ?? {
                    filePath: "", x: 1680, y: 40, widthPx: 180, opacity: 0.82
                });
                setExhibition(settings.exhibitionStyle ?? DEFAULT_EXHIBITION_STYLE);
            })
            .catch((error: unknown) => {
                console.error(error);
                setStatus(
                    "Não foi possível carregar o perfil de saída."
                );
            });
    }, []);

    // A marca d'água é editada em outra aba. Ao voltar para Identificação,
    // atualizar a posição do logo antes de desenhar a prévia.
    useEffect(() => {
        if (tab !== "exhibition") return;
        let cancelled = false;
        window.santtosAPI.getSettings()
            .then((settings) => {
                if (!cancelled && settings.watermarkStyle) {
                    setWatermarkPosition(settings.watermarkStyle);
                }
            })
            .catch((error) => console.error("Falha ao atualizar posição do logo:", error));
        return () => { cancelled = true; };
    }, [tab]);

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

    function patchOmt(
        values: Partial<OutputSettings["omt"]>
    ) {
        setOutput((current) => ({
            ...current,
            omt: {
                ...current.omt,
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

    function patchExhibition(values: Partial<ExhibitionStyle>) {
        setExhibition(current => ({ ...current, ...values }));
        setStatus("");
    }

    async function saveExhibition() {
        setIsSaving(true);
        try {
            await onSaveExhibition(exhibition);
            setStatus("Identificação salva e prévia atualizada.");
        } catch (error) {
            console.error("Falha ao salvar identificação:", error);
            setStatus("Não foi possível salvar a identificação no vídeo.");
        } finally {
            setIsSaving(false);
        }
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
                    result?.error ??
                    "Falha ao salvar perfil de saída."
                );
            }

            setOutput(result.output);
            setStatus(result.pendingProfile
                ? "Saídas atualizadas. O novo perfil de vídeo/áudio será aplicado no próximo corte ou ao parar."
                : "Saídas atualizadas com a reprodução mantida.");
        } catch (error) {
            console.error(error);
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Não foi possível salvar o perfil de saída."
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

    const tabHeading: Record<
        SettingsTab,
        { title: string; description: string }
    > = {
        output: {
            title: "Saída e transporte",
            description:
                "Perfil técnico do PROGRAM, áudio e transportes."
        },
        operation: { title: "Operação e recuperação", description: "Continuidade do PROGRAM, contingência e início automático." },
        backup: { title: "Backup de dados", description: "Programação, cadastros, configurações e relatórios. Sem vídeos." },
        cache: { title: "Cache de mídia", description: "Cache automático de discos e pastas de rede." },
        library: {
            title: "Biblioteca",
            description:
                "Pastas e organização das mídias do Playout."
        },
        watermark: {
            title: "Marca d'água",
            description:
                "Logo, tamanho, posição, opacidade e fade."
        },
        exhibition: {
            title: "Identificação no vídeo",
            description:
                "Tipografia e posição das identificações editoriais."
        },
        hashtag: {
            title: "Hashtag / GC",
            description:
                "Tipografia e aparência do texto sobre o PROGRAM."
        },
        reporting: {
            title: "Relatórios de exibição",
            description:
                "Destino e formato dos registros de tudo que foi ao ar."
        }
    };

    return (
        <section className="panel broadcast-settings-panel">
            <div className="broadcast-settings-header">
                <div>
                    <div className="panel-title">
                        CONFIGURAÇÕES
                    </div>
                    <h1>{tabHeading[tab].title}</h1>
                    <p>
                        {tabHeading[tab].description}
                    </p>
                </div>

                <div className="settings-tabs">
                    <button className={tab === "operation" ? "active" : ""} onClick={() => setTab("operation")}>Operação</button>
                    <button className={tab === "backup" ? "active" : ""} onClick={() => setTab("backup")}>Backup</button>
                    <button type="button" className={tab === "cache" ? "active" : ""} onClick={() => setTab("cache")}>Cache</button>
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
                            tab === "library"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("library")
                        }
                    >
                        Biblioteca
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
                        className={tab === "exhibition" ? "active" : ""}
                        onClick={() => setTab("exhibition")}
                    >
                        Identificação no vídeo
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
                    <button
                        type="button"
                        className={
                            tab === "reporting"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("reporting")
                        }
                    >
                        Relatórios
                    </button>
                </div>
            </div>

            {tab === "output" ? (
                <OutputTab
                    output={output}
                    patchOutput={patchOutput}
                    patchAudio={patchAudio}
                    patchNdi={patchNdi}
                    patchOmt={patchOmt}
                    patchSrt={patchSrt}
                />
            ) : tab === "operation" ? (
                <OperationSettingsTab />
            ) : tab === "backup" ? (
                <DataBackupSettingsTab />
            ) : tab === "cache" ? (
                <CacheSettingsTab />
            ) : tab === "library" ? (
                <LibraryFolderSettingsTab />
            ) : tab === "watermark" ? (
                <WatermarkSettingsTab />
            ) : tab === "exhibition" ? (
                <ExhibitionSettingsTab
                    style={exhibition}
                    watermark={watermarkPosition}
                    patch={patchExhibition}
                />
            ) : tab === "reporting" ? (
                <ReportingSettingsTab />
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
                              : tab === "exhibition"
                                ? saveExhibition
                                : undefined
                    }
                    style={
                        (
                            tab === "operation" ||
                            tab === "backup" ||
                            tab === "watermark" ||
                            tab === "library" ||
                            tab === "reporting"
                        )
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
    patchOmt,
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
    patchOmt: (
        values: Partial<OutputSettings["omt"]>
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


            </SettingsCard>

            <SettingsCard
                title="NDI / OMT"
                description="Saída de rede local do PROGRAM."
                className="network-output-settings"
            >
                <div className="network-output-toggles">
                    <ToggleField
                        label="Ativar NDI"
                        checked={output.ndi.enabled}
                        onChange={(enabled) => patchNdi({ enabled })}
                    />
                    <ToggleField
                        label="Ativar OMT"
                        checked={output.omt.enabled}
                        onChange={(enabled) => patchOmt({ enabled })}
                    />
                </div>

                <TextField
                    label="Nome da fonte"
                    value={output.ndi.name}
                    onChange={(name) => patchNdi({ name })}
                />

            </SettingsCard>

            <SettingsCard title="RTMP" description="Saída do PROGRAM para servidor de streaming.">
                <ToggleField label="Ativar RTMP" checked={output.rtmp.enabled} onChange={enabled => patchOutput({ rtmp: { ...output.rtmp, enabled } })} />
                <TextField label="URL do servidor / chave" value={output.rtmp.url} onChange={url => patchOutput({ rtmp: { ...output.rtmp, url } })} />
            </SettingsCard>
            <SettingsCard
                title="SRT"
                description={output.srt.mode === "listener"
                    ? "No vMix, use SRT Caller para conectar ao IP deste computador e à porta abaixo."
                    : "No vMix, use SRT Listener na mesma porta. Para o mesmo PC, use 127.0.0.1."}
            >
                <ToggleField
                    label="Ativar SRT"
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
                            mode: value as OutputSettings["srt"]["mode"],
                            host: value === "listener" && output.srt.host === "127.0.0.1" ? "0.0.0.0"
                                : value !== "listener" && output.srt.host === "0.0.0.0" ? "127.0.0.1" : output.srt.host
                        })
                    }
                />

                <div className="settings-two-columns">
                    {output.srt.mode !== "listener" && <TextField
                        label="IP do receptor"
                        value={output.srt.host}
                        onChange={(host) =>
                            patchSrt({ host })
                        }
                    />}
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
                        ["Montserrat", "Montserrat"],
                        ["Inter", "Inter"],
                        ["Poppins", "Poppins"],
                        ["Oswald", "Oswald"],
                        ["Roboto Condensed", "Roboto Condensed"],
                        ["Tahoma", "Tahoma"],
                        ["Verdana", "Verdana"],
                        ["Calibri", "Calibri"]
                    ]}
                    onChange={(fontFamily) =>
                        patch({ fontFamily })
                    }
                />
                <NumericRangeSetting
                    label="Tamanho da fonte"
                    value={style.fontSize}
                    min={10}
                    max={160}
                    step={1}
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

function NumericRangeSetting({
    label,
    value,
    min,
    max,
    step = 1,
    suffix = "",
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
            <span className="broadcast-range-heading">
                <span>{label}</span>
                <strong>
                    {Math.round(value)}
                    {suffix}
                </strong>
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
