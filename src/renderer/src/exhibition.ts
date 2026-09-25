export const EXHIBITION_OPTIONS = [
    { value: "NORMAL", label: "Normal" },
    { value: "INEDITO", label: "Inédito" },
    { value: "REPRISE", label: "Reprise" },
    { value: "ESTREIA", label: "Estreia" },
    { value: "ESPECIAL", label: "Especial" },
    { value: "AO_VIVO", label: "Ao vivo" }
] as const;

export type ExhibitionType = typeof EXHIBITION_OPTIONS[number]["value"];

export function normalizeExhibitionType(value: unknown): ExhibitionType {
    const selected = EXHIBITION_OPTIONS.find((option) => option.value === value);
    return selected?.value ?? "NORMAL";
}

export function exhibitionLabel(value: unknown): string {
    return EXHIBITION_OPTIONS.find((option) => option.value === value)?.label ?? "Normal";
}


// Configuração global da tipografia editorial desenhada NO vídeo.
export interface ExhibitionStyle {
    enabled: boolean;
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    color: string;
    opacity: number;
    outlineWidth: number;
    outlineColor: string;
    outlineOpacity: number;
    shadowEnabled: boolean;
    shadowColor: string;
    shadowOpacity: number;
    shadowX: number;
    shadowY: number;
    backgroundEnabled: boolean;
    backgroundColor: string;
    backgroundOpacity: number;
    backgroundPadding: number;
    gapPx: number;
    rightOffsetPx: number;
    yOffsetPx: number;
    labels: Record<Exclude<ExhibitionType, "NORMAL">, string>;
}

export const DEFAULT_EXHIBITION_STYLE: ExhibitionStyle = {
    enabled: true,
    fontFamily: "Arial",
    fontSize: 26,
    bold: true,
    color: "#ffffff",
    opacity: 1,
    outlineWidth: 1,
    outlineColor: "#000000",
    outlineOpacity: 0.65,
    shadowEnabled: false,
    shadowColor: "#000000",
    shadowOpacity: 0.65,
    shadowX: 1,
    shadowY: 1,
    backgroundEnabled: false,
    backgroundColor: "#111111",
    backgroundOpacity: 0.78,
    backgroundPadding: 5,
    gapPx: 4,
    rightOffsetPx: 0,
    yOffsetPx: 0,
    labels: {
        INEDITO: "INÉDITO",
        REPRISE: "REPRISE",
        ESTREIA: "ESTREIA",
        ESPECIAL: "ESPECIAL",
        AO_VIVO: "AO VIVO"
    }
};

export function exhibitionText(type: unknown, style: ExhibitionStyle): string {
    if (!style.enabled || !type || type === "NORMAL") return "";
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_EXHIBITION_STYLE.labels, type)) return "";
    const key = type as Exclude<ExhibitionType, "NORMAL">;
    return style.labels[key] || DEFAULT_EXHIBITION_STYLE.labels[key];
}

function clampCoordinate(value: unknown, fallback: number, min: number, max: number) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(max, Math.max(min, Math.round(number)))
        : fallback;
}

/** Coordinates identical to src/core/graphics/exhibition-overlay.js at 1920x1080. */
export function exhibitionPreviewAnchor(
    watermark: { x: number; y: number; widthPx: number },
    style: ExhibitionStyle = DEFAULT_EXHIBITION_STYLE
) {
    const logoX = clampCoordinate(watermark.x, 1680, 0, 1920);
    const logoY = clampCoordinate(watermark.y, 40, 0, 1080);
    const logoWidth = clampCoordinate(watermark.widthPx, 180, 1, 1920);
    const right = clampCoordinate(
        logoX + logoWidth + style.rightOffsetPx,
        1860, 8 + style.backgroundPadding, 1920 - 8 - style.backgroundPadding
    );
    const top = clampCoordinate(
        logoY - style.fontSize - style.backgroundPadding * 2 - style.gapPx + style.yOffsetPx,
        8, 8, 1080 - style.fontSize
    );
    return {
        right: String(((1920 - right) / 1920) * 100) + "%",
        top: String((top / 1080) * 100) + "%"
    };
}

function rgba(hex: string, opacity: number) {
    const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000";
    return "rgba(" + [
        parseInt(safe.slice(1, 3), 16),
        parseInt(safe.slice(3, 5), 16),
        parseInt(safe.slice(5, 7), 16),
        opacity
    ].join(", ") + ")";
}

export function exhibitionPreviewStyle(
    watermark: { x: number; y: number; widthPx: number },
    style: ExhibitionStyle = DEFAULT_EXHIBITION_STYLE
) {
    return {
        ...exhibitionPreviewAnchor(watermark, style),
        fontFamily: style.fontFamily + ", Arial, sans-serif",
        fontWeight: style.bold ? 700 : 400,
        fontSize: "clamp(6px, " + (style.fontSize / 19.2) + "cqw, " + style.fontSize + "px)",
        color: rgba(style.color, style.opacity),
        WebkitTextStroke: style.outlineWidth > 0
            ? String(style.outlineWidth / 19.2) + "cqw " + rgba(style.outlineColor, style.outlineOpacity)
            : undefined,
        textShadow: style.shadowEnabled
            ? (style.shadowX / 19.2) + "cqw " + (style.shadowY / 19.2) +
              "cqw 0.12cqw " + rgba(style.shadowColor, style.shadowOpacity)
            : "none",
        background: style.backgroundEnabled
            ? rgba(style.backgroundColor, style.backgroundOpacity)
            : "transparent",
        padding: style.backgroundEnabled
            ? "0.15cqw " + (style.backgroundPadding / 19.2) + "cqw"
            : "0",
        textAlign: "right" as const
    };
}
