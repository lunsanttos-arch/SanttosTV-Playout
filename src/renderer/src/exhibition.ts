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
