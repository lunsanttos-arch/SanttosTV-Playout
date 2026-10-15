export function splitContentName(filename: string | undefined | null): { code: string; name: string };
export function contentLabel(item: { name?: string; fileName?: string; path?: string; filePath?: string; placeholder?: boolean; liveSlot?: boolean; blockLabel?: string; contentCode?: string; contentName?: string }): { code: string; name: string };
