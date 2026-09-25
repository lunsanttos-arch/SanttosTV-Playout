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

/**
 * Match the PROGRAM FFmpeg overlay anchor at 1920x1080. Percentages ensure
 * the operator monitor shows the same label location as the NDI picture.
 */
export function exhibitionPreviewAnchor(watermark: {
    x: number;
    y: number;
    widthPx: number;
}) {
    const clampCoordinate = (value: number, fallback: number, min: number, max: number) =>
        Number.isFinite(Number(value))
            ? Math.min(max, Math.max(min, Math.round(Number(value))))
            : fallback;

    const logoX = clampCoordinate(watermark.x, 1680, 0, 1920);
    const logoY = clampCoordinate(watermark.y, 40, 0, 1080);
    const width = clampCoordinate(watermark.widthPx, 180, 1, 1920);
    const right = clampCoordinate(logoX + width, 1860, 13, 1907);
    const top = Math.max(8, logoY - 40);

    return {
        right: `${((1920 - right) / 1920) * 100}%`,
        top: `${(top / 1080) * 100}%`
    };
}
