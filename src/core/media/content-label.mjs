// Content codes belong to the file prefix; preserve the original path/name for audit.
export function splitContentName(filename) {
    const raw = String(filename ?? '').replace(/\\/g, '/').split('/').pop().trim();
    const name = raw.replace(/\.(?:mp4|mkv|mov|avi|mxf|ts|m2ts|mts|mpeg|mpg|m4v|wmv|webm|vob|wav|mp3|aac|flac|ogg|aiff|m3u8)$/i, '').trim();
    const explicit = name.match(/^([A-Za-z0-9][A-Za-z0-9.-]{0,39})\s*(_|\s[-–—]\s)\s*(.+)$/);
    if (explicit && (/\d/.test(explicit[1]) || /^(?:AB|ENC)[A-Z0-9]{2,13}$/.test(explicit[1]) || (explicit[2] !== '_' && /^[A-Z]{2,16}$/.test(explicit[1]))))
        return { code: explicit[1], name: explicit[3].trim() };
    const numeric = name.match(/^(\d{1,12})\s*(?:[-–—]|\s)\s*(.+)$/);
    if (numeric) return { code: numeric[1], name: numeric[2].trim() };
    return { code: '', name };
}
export function contentLabel(item) {
    const original = item?.name || item?.fileName || item?.path || item?.filePath || '';
    if (item?.placeholder) return { code: item.blockLabel || '', name: item.name || (item.liveSlot ? 'Ao Vivo' : 'Conteúdo a definir') };
    const parsed = splitContentName(original);
    return { code: item?.contentCode || parsed.code || item?.blockLabel || '', name: item?.contentName || parsed.name };
}
