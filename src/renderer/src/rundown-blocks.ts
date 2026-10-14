import type { RundownItem } from "./App";

export function splitRundownItem(item: RundownItem, count: number, newId: () => string): RundownItem[] {
    if (item.placeholder) throw new Error("Defina o vídeo antes de dividir em blocos.");
    const duration = Math.max(0, Number(item.duration) || 0);
    const start = Math.max(0, Number(item.inPoint) || 0);
    const end = Math.min(duration, Number(item.outPoint) > 0 ? Number(item.outPoint) : duration);
    const length = end - start;
    if (!Number.isFinite(length) || !Number.isInteger(count) || count < 2 || count > 100 || length < count)
        throw new Error("Cada bloco precisa ter pelo menos um segundo. Use de 2 a 100 blocos.");
    return Array.from({ length: count }, (_, index) => {
        const from = start + length * index / count;
        const to = index === count - 1 ? end : start + length * (index + 1) / count;
        return {
            ...item,
            rundownItemId: newId(),
            blockLabel: `${item.blockLabel ? item.blockLabel.slice(0, 60) + " · " : ""}Bloco ${index + 1}/${count}`,
            inPoint: from, outPoint: to,
            loop: false, freezeEnd: false
        };
    });
}
