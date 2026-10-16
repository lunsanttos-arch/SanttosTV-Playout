/** Calendar dates are local to the master; elapsed durations are absolute milliseconds. */
export const ALIGNMENT_TOLERANCE_SECONDS = 180;
export function previousDate(date) {
    const value = new Date(`${date}T12:00:00`);
    value.setDate(value.getDate() - 1);
    return localDate(value);
}
export function localDate(value) {
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
}
export function clipSeconds(item) {
    const start = Math.max(0, Number(item.inPoint) || 0);
    const duration = Number(item.duration);
    const out = Number(item.outPoint) > 0 ? Number(item.outPoint) : duration;
    const end = duration > 0 ? Math.min(duration, out) : out;
    if (!Number.isFinite(end) || end <= start || item.loop) return null;
    return end - start;
}
export function durationSeconds(items) {
    let total = 0;
    for (const item of items) { const length = clipSeconds(item); if (length === null) return null; total += length; }
    return total;
}
export function clockDuration(seconds) {
    const total = Math.ceil(Math.abs(seconds));
    return `${String(Math.floor(total/3600)).padStart(2,'0')}:${String(Math.floor(total/60)%60).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
export function scheduleBounds(date, startTime, items, previous = null) {
    const linked = previous !== null;
    const start = linked ? Date.parse(previous.endAt) : new Date(`${date}T${startTime}:00`).getTime();
    const seconds = durationSeconds(items);
    return {
        startAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
        endAt: Number.isFinite(start) && seconds !== null ? new Date(start + seconds*1000).toISOString() : null,
        previousDate: linked ? previous.date : null,
        previousUpdatedAt: linked ? previous.updatedAt ?? null : null
    };
}
export function alignmentMessage(delta) {
    if (Math.abs(delta) < .001) return 'Grades alinhadas.';
    return `${delta > 0 ? 'Faltam' : 'Sobram'} ${clockDuration(delta)} para alinhar as duas grades.`;
}
/** Pure transaction planning: no queue or decoder mutation until all validation passes. */
export function planRundownApplication({ items, date, startAt, queue = [], snapshot = {}, nowMs = Date.now() }) {
    const start = Date.parse(startAt);
    if (!Number.isFinite(start) || !items.length || durationSeconds(items) === null)
        throw Error('Não é possível aplicar: início ou duração da programação desconhecidos.');
    if (items.some(item => item.placeholder && !item.liveSlot)) throw Error('Substitua os conteúdos a definir antes de aplicar.');
    if (queue.some(item => item.scheduleDate === date)) throw Error('Esta programação já está no Playout. Remova a grade anterior antes de reaplicá-la.');
    const active = ['PLAYING', 'STARTING', 'PAUSED'].includes(snapshot.state);
    if (active && snapshot.state === 'PAUSED') throw Error('Retome a reprodução para calcular o encaixe das grades.');
    const index = active ? queue.findIndex(item => item.id === snapshot.itemId) : -1;
    let retained = [], boundary = nowMs;
    if (active && index < 0) throw Error('Aguarde a atualização do material no ar antes de aplicar.');
    if (index >= 0) {
        retained = queue;
        let remaining = 0;
        for (let i=index;i<queue.length;i++) {
            const item = queue[i], length = clipSeconds(item);
            if (length === null || item.freezeEnd || item.liveSlot) throw Error('Não é possível prever o término: há LOOP, FREEZE, entrada ao vivo manual ou duração desconhecida na fila.');
            remaining += i === index ? Math.max(0, length - Math.max(0, (Number(snapshot.positionSeconds)||0) - (Number(item.inPoint)||0))) : length;
        }
        boundary += remaining*1000;
    }
    let incoming = items.map(item => ({...item})), position = null;
    // An empty/stopped player joins today's clock, including a clip crossing midnight.
    if (!retained.length && start < nowMs) {
        let cursor = start, first = -1;
        for (let i=0;i<incoming.length;i++) {
            const end = cursor + clipSeconds(incoming[i])*1000;
            if (nowMs < end) { first=i; position=(Number(incoming[i].inPoint)||0)+(nowMs-cursor)/1000; break; }
            cursor=end;
        }
        if (first < 0) throw Error('Esta programação já terminou. Selecione a grade da data correspondente.');
        incoming = incoming.slice(first);
        incoming[0].inPoint = position;
        boundary=nowMs;
        // The clock already consumed the preceding materials and part of this one.
        return stamp(incoming, date, boundary, 0, retained, position);
    }
    const delta = (start-boundary)/1000;
    if (Math.abs(delta) > ALIGNMENT_TOLERANCE_SECONDS + .000001)
        throw Error(`${alignmentMessage(delta)} Aplicação bloqueada: tolerância de 00:03:00. Ajuste ${clockDuration(Math.abs(delta)-ALIGNMENT_TOLERANCE_SECONDS)} para entrar na tolerância, ou ${clockDuration(delta)} para alinhar exatamente.`);
    return stamp(incoming,date,boundary,delta,retained,position);
}
function stamp(items,date,boundary,delta,retained,position) {
    let cursor=boundary;
    const prepared=items.map(item=>{const result={...item,scheduleDate:date,programmedStartAt:new Date(cursor+delta*1000).toISOString(),effectiveStartAt:new Date(cursor).toISOString()};cursor+=clipSeconds(item)*1000;return result;});
    return { timeline:[...retained,...prepared], deltaSeconds:delta, positionSeconds:position,
        message:`${alignmentMessage(delta)}${delta ? ' Grade encaixada em sequência; compensação manual pelo master.' : ''}` };
}
