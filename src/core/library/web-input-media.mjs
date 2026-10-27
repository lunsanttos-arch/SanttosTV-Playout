import { clipSeconds } from '../scheduling/broadcast-schedule.mjs';

export function secondsUntilInputClock(endTime, now = new Date()) {
    const [hours, minutes, seconds = 0] = endTime.split(':').map(Number);
    const end = new Date(now);end.setHours(hours, minutes, seconds, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return Math.max(1, (end.getTime() - now.getTime()) / 1000);
}

export function webInputToMedia(input) {
    const duration = Math.max(1, Number(input.durationSeconds) || 60);
    return { id: `input:${input.id}`, sourceMediaId: `input:${input.id}`, sourceType: 'input',
        inputId: input.id, inputProtocol: input.protocol, inputTimingMode: input.timingMode,
        inputEndTime: input.endTime, inputHttpReferer: input.httpReferer || '', inputHttpUserAgent: input.httpUserAgent || '',
        inputEngine: input.engine || 'auto', fitMode: input.fitMode, sizePercent: input.sizePercent || 100,
        premiumFeature: true, name: input.name, path: input.url,
        extension: ['hls','m3u8'].includes(input.protocol) ? 'M3U8' : input.protocol.toUpperCase(),
        fileSize: 0, duration, width: null, height: null, fps: null, videoCodec: 'STREAM', audioCodec: null,
        thumbnail: null, status: 'stream', createdAt: input.createdAt, loop: false, freezeEnd: false,
        watermark: false, hashtag: '', inPoint: 0, outPoint: duration, blockLabel: 'INPUT' };
}

// Clock inputs reserve their time from the planned entry, never from the time
// at which the operator opens the editor. This also handles midnight rollover.
export function scheduleInputClocks(items, startAt) {
    let cursor = startAt ? Date.parse(startAt) : NaN;
    return items.map(item => {
        let next = item;
        if (Number.isFinite(cursor) && item.sourceType === 'input' && item.inputTimingMode === 'clock' &&
            /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.inputEndTime || '')) {
            const duration = secondsUntilInputClock(item.inputEndTime, new Date(cursor));
            next = { ...item, duration, inPoint: 0, outPoint: duration };
        }
        const seconds = clipSeconds(next);
        cursor = seconds === null ? NaN : cursor + seconds * 1000;
        return next;
    });
}
