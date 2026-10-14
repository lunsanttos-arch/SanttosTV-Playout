import type { RundownItem } from "./App";
export type BlockRange = { inPoint: number; outPoint: number };

export function placeRundownBlocks(items: RundownItem[], sourceId: string, ranges: BlockRange[]): RundownItem[] {
    const index = items.findIndex(item => item.rundownItemId === sourceId);
    const source = items[index];
    if (!source || source.placeholder || !source.replacedPlaceholder)
        throw new Error("Somente um vídeo que substituiu um Conteúdo a definir pode ser dividido.");
    const duration = Number(source.duration);
    if (!Number.isFinite(duration) || ranges.length < 1 || ranges.length > 6 || !ranges.every((range, i) =>
        Number.isFinite(range.inPoint) && Number.isFinite(range.outPoint) && range.inPoint >= 0 &&
        range.outPoint > range.inPoint && range.outPoint <= duration + .01 &&
        (i === 0 || range.inPoint >= ranges[i - 1].outPoint)))
        throw new Error("Defina de 1 a 6 blocos válidos, em ordem, sem sobreposição.");
    const positions = [index];
    for (let i = index + 1; i < items.length && positions.length < ranges.length; i++)
        if (items[i].placeholder && !items[i].liveSlot) positions.push(i);
    if (positions.length < ranges.length)
        throw new Error(`Há ${positions.length - 1} lacuna(s) seguinte(s). São necessárias ${ranges.length - 1} para estes blocos.`);
    const result = [...items];
    positions.forEach((position, block) => {
        const slot = items[position];
        result[position] = {
            ...source, rundownItemId: slot.rundownItemId,
            blockLabel: slot.blockLabel || `Bloco ${block + 1}`,
            notes: slot.notes || "", ...ranges[block],
            placeholder: false, replacedPlaceholder: true, loop: false, freezeEnd: false
        };
    });
    return result;
}

export interface RundownDraft { items: RundownItem[]; history: RundownItem[][] }
export type DraftAction = { type: "load"; items: RundownItem[] } | { type: "normalize"; items: RundownItem[] } | { type: "undo" } |
    { type: "edit"; update: RundownItem[] | ((items: RundownItem[]) => RundownItem[]) };
export function rundownDraftReducer(state: RundownDraft, action: DraftAction): RundownDraft {
    if (action.type === "load") return { items: action.items, history: [] };
    if (action.type === "normalize") return { items: action.items, history: state.history };
    if (action.type === "undo") return state.history.length
        ? { items: state.history[state.history.length - 1], history: state.history.slice(0, -1) } : state;
    const items = typeof action.update === "function" ? action.update(state.items) : action.update;
    if (JSON.stringify(items) === JSON.stringify(state.items)) return state;
    return { items, history: [...state.history.slice(-49), state.items] };
}
