/**
 * Previsão ao vivo da timeline. Nunca converter uma duração estática em
 * horário de entrada se o PROGRAM está parado ou sem mídia analisada.
 * O registro é por OCORRÊNCIA (id), não pelo caminho do arquivo.
 */
export interface ForecastMedia {
    id: string;
    name?: string;
    duration?: number | null;
    inPoint?: number | null;
    outPoint?: number | null;
    loop?: boolean;
}

export type ForecastState =
    | "current" | "upcoming" | "loop" | "paused" | "waiting"
    | "unknown-duration" | "blocked-loop" | "blocked-duration";

export interface ForecastEntry {
    state: ForecastState;
    remainingSeconds: number | null;
    startsAtMs: number | null;
    endsAtMs: number | null;
}

export interface ForecastResult {
    entries: Map<string, ForecastEntry>;
    remainingSeconds: number | null;
    endsAtMs: number | null;
    hasLoop: boolean;
    isLive: boolean;
}

function finitePositive(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** Intervalo editado, respeitando IN e OUT em segundos do arquivo original. */
export function knownClipRange(item: ForecastMedia): {
    inPoint: number;
    outPoint: number;
    length: number;
} | null {
    const total = finitePositive(item.duration);
    const rawIn = Number(item.inPoint);
    const inPoint = Number.isFinite(rawIn) && rawIn > 0 ? rawIn : 0;
    const explicitOut = finitePositive(item.outPoint);
    const outPoint = explicitOut !== null
        ? total !== null ? Math.min(total, explicitOut) : explicitOut
        : total;
    if (outPoint === null || outPoint <= inPoint) return null;
    return { inPoint, outPoint, length: outPoint - inPoint };
}

function unknown(state: ForecastState): ForecastEntry {
    return { state, remainingSeconds: null, startsAtMs: null, endsAtMs: null };
}

export function buildTimelineForecast(
    queue: ForecastMedia[],
    selectedMediaId: string | null,
    options: {
        nowMs: number;
        isRunning: boolean;
        currentTime: number;
        /** Timestamp da última amostra válida do tempo do player. */
        sampledAtMs?: number;
    }
): ForecastResult {
    const entries = new Map<string, ForecastEntry>();
    const now = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const sampledAtMs = options.sampledAtMs !== undefined &&
        Number.isFinite(options.sampledAtMs)
            ? options.sampledAtMs : now;
    const selectedIndex = selectedMediaId === null
        ? -1 : queue.findIndex(item => item.id === selectedMediaId);
    // Loops já executados não podem bloquear a previsão da fila atual.
    const hasLoop = queue.slice(Math.max(0, selectedIndex))
        .some(item => item.loop === true);

    if (selectedIndex < 0 || !options.isRunning ||
        !Number.isFinite(options.currentTime)) {
        const selectedExists = selectedIndex >= 0;
        queue.slice(Math.max(0, selectedIndex)).forEach((item, index) => {
            entries.set(item.id,
                unknown(index === 0 && selectedExists ? "paused" : "waiting"));
        });
        return {
            entries, remainingSeconds: null, endsAtMs: null,
            hasLoop, isLive: false
        };
    }

    let cumulative = 0;
    let blocker: "blocked-loop" | "blocked-duration" | null = null;
    const remainingItems = queue.slice(selectedIndex);

    remainingItems.forEach((item, index) => {
        if (blocker) {
            entries.set(item.id, unknown(blocker));
            return;
        }

        const clip = knownClipRange(item);
        if (!clip) {
            entries.set(item.id, unknown("unknown-duration"));
            blocker = "blocked-duration";
            return;
        }

        let length = clip.length;
        if (index === 0) {
            const currentTime = options.currentTime;
            if (currentTime < clip.inPoint - 0.5) {
                entries.set(item.id, unknown("waiting"));
                blocker = "blocked-duration";
                return;
            }
            // Fixar o fim na amostra de tempo do vídeo, NÃO em cada
            // redesenho do React. Assim o relógio de entrada não salta
            // para frente entre dois eventos timeupdate.
            const remainingAtSample = Math.max(0,
                clip.outPoint - Math.max(clip.inPoint, currentTime));
            const expectedClipEndMs = sampledAtMs + remainingAtSample * 1000;
            length = Math.max(0, (expectedClipEndMs - now) / 1000);
        }

        const startsAtMs = now + cumulative * 1000;
        const endsAtMs = startsAtMs + length * 1000;
        const state: ForecastState = item.loop ? "loop"
            : index === 0 ? "current" : "upcoming";
        entries.set(item.id, {
            state,
            remainingSeconds: cumulative,
            startsAtMs,
            endsAtMs: item.loop ? null : endsAtMs
        });
        cumulative += length;
        if (item.loop) blocker = "blocked-loop";
    });

    const last = remainingItems[remainingItems.length - 1];
    const lastEntry = last ? entries.get(last.id) : undefined;
    const predictable = !blocker && lastEntry?.endsAtMs !== null &&
        lastEntry?.endsAtMs !== undefined;
    return {
        entries,
        remainingSeconds: predictable ? cumulative : null,
        endsAtMs: predictable ? lastEntry!.endsAtMs : null,
        hasLoop, isLive: true
    };
}

/**
 * OPEC: horário PROGRAMADO é fixado pelo início informado no roteiro.
 * Não confundir com ENTRA EST. (previsão operacional ao vivo).
 * Um clipe sem duração ou loop invalida os horários seguintes.
 */
export interface PlannedSchedule {
    times: Map<string, string>;
    end: string;
    totalSeconds: number | null;
}

function formatPlannedClock(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const remainder = total % 86400;
    const clock = [
        Math.floor(remainder / 3600),
        Math.floor((remainder % 3600) / 60),
        remainder % 60
    ].map(value => String(value).padStart(2, "0")).join(":");
    return days === 0 ? clock
        : clock + (days === 1 ? " (+1 dia)" : ` (+${days} dias)`);
}

export function buildPlannedSchedule(
    items: ForecastMedia[],
    startTime: string
): PlannedSchedule {
    const times = new Map<string, string>();
    const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)
        ? startTime.split(":").map(Number) : null;
    if (!match) {
        items.forEach(item => times.set(item.id, "SEM PREVISÃO — INÍCIO INVÁLIDO"));
        return { times, end: "SEM PREVISÃO", totalSeconds: null };
    }
    let cursor = match[0] * 3600 + match[1] * 60;
    let total = 0;
    let blocked: "LOOP ANTERIOR" | "DURAÇÃO ANTERIOR DESCONHECIDA" | null = null;
    for (const item of items) {
        if (blocked) {
            times.set(item.id, "SEM PREVISÃO — " + blocked);
            continue;
        }
        times.set(item.id, formatPlannedClock(cursor));
        const clip = knownClipRange(item);
        if (!clip) {
            blocked = "DURAÇÃO ANTERIOR DESCONHECIDA";
            continue;
        }
        if (item.loop) {
            blocked = "LOOP ANTERIOR";
            continue;
        }
        cursor += clip.length;
        total += clip.length;
    }
    return {
        times,
        end: blocked ? "SEM PREVISÃO" : formatPlannedClock(cursor),
        totalSeconds: blocked ? null : total
    };
}

function localCalendarDaysApart(first: Date, second: Date): number {
    const firstDay = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
    const secondDay = Date.UTC(second.getFullYear(), second.getMonth(), second.getDate());
    return Math.round((secondDay - firstDay) / 86_400_000);
}

export function formatEstimatedClock(timestampMs: number, nowMs: number): string {
    if (!Number.isFinite(timestampMs)) return "--:--:--";
    const date = new Date(timestampMs);
    const time = [
        date.getHours(), date.getMinutes(), date.getSeconds()
    ].map(value => String(value).padStart(2, "0")).join(":");
    const days = localCalendarDaysApart(new Date(nowMs), date);
    return days <= 0 ? time
        : time + (days === 1 ? " (+1 dia)" : ` (+${days} dias)`);
}

export function formatRemaining(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--:--";
    // Arredondar para cima evita anunciar 00:00:00 antes de o corte acontecer.
    const safe = Math.ceil(seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return [h, m, s].map(value => String(value).padStart(2, "0")).join(":");
}

export function describeForecastEntry(
    entry: ForecastEntry | undefined,
    nowMs: number,
    isCurrent = false
): string {
    if (!entry) return "SEM PREVISÃO — ITEM FORA DA TIMELINE";
    switch (entry.state) {
        case "current":
            return `RESTA ${formatRemaining((entry.endsAtMs! - nowMs) / 1000)} • FIM EST. ${formatEstimatedClock(entry.endsAtMs!, nowMs)}`;
        case "upcoming":
            return `FALTA ${formatRemaining(entry.remainingSeconds!)} • ENTRA EST. ${formatEstimatedClock(entry.startsAtMs!, nowMs)}`;
        case "loop":
            if (isCurrent) return "EM LOOP • SEM HORÁRIO FINAL";
            return `FALTA ${formatRemaining(entry.remainingSeconds!)} • ENTRA EST. ${formatEstimatedClock(entry.startsAtMs!, nowMs)} • LOOP`;
        case "paused":
            return "PAUSADO • HORÁRIO DE ENTRADA INDEFINIDO";
        case "waiting":
            return "AGUARDANDO PLAY • SEM PREVISÃO";
        case "unknown-duration":
            return "SEM PREVISÃO • DURAÇÃO DESCONHECIDA";
        case "blocked-duration":
            return "SEM PREVISÃO • DURAÇÃO ANTERIOR DESCONHECIDA";
        case "blocked-loop":
            return "SEM PREVISÃO • LOOP ANTERIOR";
    }
}
