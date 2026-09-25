import { useEffect, useState } from "react";
import {
    DEFAULT_EXHIBITION_STYLE,
    EXHIBITION_OPTIONS,
    exhibitionPreviewStyle,
    exhibitionText
} from "./exhibition";
import type { ExhibitionStyle, ExhibitionType } from "./exhibition";
import "./exhibition-settings.css";

type WatermarkPosition = {
    filePath: string;
    x: number;
    y: number;
    widthPx: number;
    opacity: number;
};

interface Props {
    style: ExhibitionStyle;
    watermark: WatermarkPosition;
    patch: (next: Partial<ExhibitionStyle>) => void;
}

const FONTS = ["Arial", "Segoe UI", "Tahoma", "Verdana", "Calibri"];
const LABEL_TYPES = EXHIBITION_OPTIONS.filter(option => option.value !== "NORMAL");

function FieldNumber({
    label, value, min, max, onChange, step = 1
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (n: number) => void;
    step?: number;
}) {
    return (
        <label className="exhibition-field">
            <span>{label}</span>
            <input type="number" value={value} min={min} max={max} step={step}
                onChange={event => {
                    const next = Number(event.currentTarget.value);
                    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
                }}
            />
        </label>
    );
}

function FieldColor({
    label, color, onChange
}: {
    label: string;
    color: string;
    onChange: (hex: string) => void;
}) {
    return (
        <label className="exhibition-field">
            <span>{label}</span>
            <div className="exhibition-color-row">
                <input type="color" value={color} onChange={e => onChange(e.currentTarget.value)} />
                <small>{color.toUpperCase()}</small>
            </div>
        </label>
    );
}

function Toggle({
    label, checked, onChange
}: {
    label: string;
    checked: boolean;
    onChange: (on: boolean) => void;
}) {
    return (
        <label className="exhibition-toggle">
            <input type="checkbox" checked={checked}
                onChange={event => onChange(event.currentTarget.checked)}
            />
            <span>{label}</span>
        </label>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="exhibition-card">
            <h2>{title}</h2>
            <div className="exhibition-card-fields">{children}</div>
        </section>
    );
}

export default function ExhibitionSettingsTab({ style, watermark, patch }: Props) {
    const [example, setExample] = useState<ExhibitionType>("REPRISE");
    const [logoPreview, setLogoPreview] = useState("");

    useEffect(() => {
        let cancelled = false;
        if (!watermark.filePath) {
            setLogoPreview("");
            return;
        }
        window.santtosAPI.getWatermarkPreview(watermark.filePath)
            .then(result => {
                if (!cancelled) setLogoPreview(result.ok ? result.dataUrl ?? "" : "");
            })
            .catch(() => { if (!cancelled) setLogoPreview(""); });
        return () => { cancelled = true; };
    }, [watermark.filePath]);

    function patchLabel(type: Exclude<ExhibitionType, "NORMAL">, text: string) {
        patch({ labels: { ...style.labels, [type]: text } });
    }

    return (
        <div className="exhibition-config">
            <div className="exhibition-config-columns">
                <Card title="Texto e tipografia">
                    <Toggle label="Exibir identificação no PROGRAM"
                        checked={style.enabled} onChange={enabled => patch({ enabled })} />
                    <label className="exhibition-field">
                        <span>Fonte</span>
                        <select value={style.fontFamily}
                            onChange={event => patch({ fontFamily: event.currentTarget.value })}>
                            {FONTS.map(font => <option key={font} value={font}>{font}</option>)}
                        </select>
                    </label>
                    <div className="exhibition-field-row">
                        <FieldNumber label="Tamanho (px)" value={style.fontSize} min={12} max={100}
                            onChange={fontSize => patch({ fontSize })} />
                        <Toggle label="Negrito" checked={style.bold} onChange={bold => patch({ bold })} />
                    </div>
                    <div className="exhibition-field-row">
                        <FieldColor label="Cor do texto" color={style.color}
                            onChange={color => patch({ color })} />
                        <FieldNumber label="Opacidade (0–100%)"
                            value={Math.round(style.opacity * 100)} min={0} max={100}
                            onChange={pct => patch({ opacity: pct / 100 })} />
                    </div>
                    <div className="exhibition-rule" />
                    <strong className="exhibition-label-heading">Textos exibidos por tipo</strong>
                    {LABEL_TYPES.map(item => {
                        const type = item.value as Exclude<ExhibitionType, "NORMAL">;
                        return (
                            <label className="exhibition-field" key={type}>
                                <span>{item.label}</span>
                                <input type="text" maxLength={32}
                                    value={style.labels[type]}
                                    onChange={event => patchLabel(type, event.currentTarget.value)}
                                    placeholder={DEFAULT_EXHIBITION_STYLE.labels[type]}
                                />
                            </label>
                        );
                    })}
                    <small>Até 32 caracteres por identificação. A opção Normal não imprime texto.</small>
                </Card>

                <Card title="Posição em relação ao logo">
                    <p className="exhibition-description">
                        O alinhamento horizontal acompanha a borda direita do logo.
                        O texto fica acima dele por padrão.
                    </p>
                    <FieldNumber label="Distância acima do logo (px)" value={style.gapPx} min={0} max={120}
                        onChange={gapPx => patch({ gapPx })} />
                    <FieldNumber label="Deslocamento horizontal (px)" value={style.rightOffsetPx}
                        min={-600} max={600} onChange={rightOffsetPx => patch({ rightOffsetPx })} />
                    <FieldNumber label="Deslocamento vertical (px)" value={style.yOffsetPx}
                        min={-400} max={400} onChange={yOffsetPx => patch({ yOffsetPx })} />
                    <small>Os limites da imagem são respeitados. Se o logo estiver no topo, pode ser necessário movê-lo para baixo.</small>
                </Card>

                <Card title="Contorno e sombra">
                    <div className="exhibition-field-row">
                        <FieldNumber label="Contorno (px)" value={style.outlineWidth} min={0} max={8}
                            onChange={outlineWidth => patch({ outlineWidth })} />
                        <FieldColor label="Cor do contorno" color={style.outlineColor}
                            onChange={outlineColor => patch({ outlineColor })} />
                    </div>
                    <FieldNumber label="Opacidade do contorno (%)" value={Math.round(style.outlineOpacity * 100)}
                        min={0} max={100} onChange={pct => patch({ outlineOpacity: pct / 100 })} />
                    <Toggle label="Sombra" checked={style.shadowEnabled}
                        onChange={shadowEnabled => patch({ shadowEnabled })} />
                    {style.shadowEnabled && (
                        <>
                            <FieldColor label="Cor da sombra" color={style.shadowColor}
                                onChange={shadowColor => patch({ shadowColor })} />
                            <FieldNumber label="Opacidade da sombra (%)"
                                value={Math.round(style.shadowOpacity * 100)} min={0} max={100}
                                onChange={pct => patch({ shadowOpacity: pct / 100 })} />
                            <div className="exhibition-field-row">
                                <FieldNumber label="Sombra X (px)" value={style.shadowX} min={-20} max={20}
                                    onChange={shadowX => patch({ shadowX })} />
                                <FieldNumber label="Sombra Y (px)" value={style.shadowY} min={-20} max={20}
                                    onChange={shadowY => patch({ shadowY })} />
                            </div>
                        </>
                    )}
                </Card>

                <Card title="Fundo (opcional)">
                    <Toggle label="Exibir tarja atrás do texto" checked={style.backgroundEnabled}
                        onChange={backgroundEnabled => patch({ backgroundEnabled })} />
                    <p className="exhibition-description">
                        Desligado por padrão: apenas texto e contorno, sem tarja preta.
                    </p>
                    {style.backgroundEnabled && (
                        <>
                            <FieldColor label="Cor da tarja" color={style.backgroundColor}
                                onChange={backgroundColor => patch({ backgroundColor })} />
                            <FieldNumber label="Opacidade da tarja (%)"
                                value={Math.round(style.backgroundOpacity * 100)} min={0} max={100}
                                onChange={pct => patch({ backgroundOpacity: pct / 100 })} />
                            <FieldNumber label="Margem interna (px)" value={style.backgroundPadding}
                                min={0} max={24}
                                onChange={backgroundPadding => patch({ backgroundPadding })} />
                        </>
                    )}
                </Card>

                <Card title="Prévia da identificação">
                    <label className="exhibition-field">
                        <span>Exemplo</span>
                        <select value={example} onChange={e => setExample(e.currentTarget.value as ExhibitionType)}>
                            {EXHIBITION_OPTIONS.map(item => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </label>
                    <div className="exhibition-live-preview">
                        <span className="exhibition-preview-caption">SIMULAÇÃO DO PROGRAM · 1920×1080</span>
                        {logoPreview
                            ? <img className="exhibition-preview-logo" src={logoPreview} alt="Logo"
                                style={{
                                    left: String((watermark.x / 1920) * 100) + "%",
                                    top: String((watermark.y / 1080) * 100) + "%",
                                    width: String((watermark.widthPx / 1920) * 100) + "%",
                                    opacity: watermark.opacity
                                }}
                            />
                            : <div className="exhibition-preview-logo-placeholder"
                                style={{
                                    left: String((watermark.x / 1920) * 100) + "%",
                                    top: String((watermark.y / 1080) * 100) + "%",
                                    width: String((watermark.widthPx / 1920) * 100) + "%"
                                }}>LOGO</div>
                        }
                        {exhibitionText(example, style) && (
                            <span className="program-exhibition-overlay"
                                style={exhibitionPreviewStyle(watermark, style)}>
                                {exhibitionText(example, style)}
                            </span>
                        )}
                    </div>
                    <p className="exhibition-description">
                        Prévia aproximada. O FFmpeg desenha a versão final na saída NDI.
                        Alterações salvas entram no próximo vídeo ou ao reiniciar o atual.
                    </p>
                </Card>
            </div>
        </div>
    );
}
