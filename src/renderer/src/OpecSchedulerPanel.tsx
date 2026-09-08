import { useEffect, useMemo, useState } from "react";
import "./opec-scheduler.css";

interface MediaItem {
    id: string;
    sourceMediaId?: string;
    name: string;
    path: string;
    extension: string;
    duration: number | null;
    inPoint?: number;
    outPoint?: number | null;
    blockLabel?: string;
    watermark?: boolean;
    hashtag?: string;
}

interface RundownItem extends MediaItem {
    rundownItemId: string;
    sourceMediaId: string;
    notes: string;
}

interface DailyRundown {
    date: string;
    title: string;
    startTime: string;
    items: RundownItem[];
    updatedAt?: string;
}

interface Props {
    media: MediaItem[];
    onApply: (items: MediaItem[]) => void;
}

function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function clipIn(item: MediaItem) {
    const value = Number(item.inPoint);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clipOut(item: MediaItem) {
    const duration = Math.max(0, Number(item.duration) || 0);
    const value = Number(item.outPoint);
    if (!Number.isFinite(value) || value <= 0) return duration;
    return duration > 0 ? Math.min(duration, value) : value;
}

function clipDuration(item: MediaItem) {
    return Math.max(0, clipOut(item) - clipIn(item));
}

function formatDuration(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function timeToSeconds(value: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

function secondsToClock(value: number) {
    const day = 24 * 3600;
    const safe = ((Math.floor(value) % day) + day) % day;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export default function OpecSchedulerPanel({ media, onApply }: Props) {
    const [date, setDate] = useState(todayKey());
    const [title, setTitle] = useState("Roteiro diário");
    const [startTime, setStartTime] = useState("06:00");
    const [items, setItems] = useState<RundownItem[]>([]);
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    const [draggedId, setDraggedId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setStatus("");

        window.santtosAPI.getDailyRundown(date)
            .then((rundown: DailyRundown) => {
                if (cancelled) return;
                setTitle(rundown.title || "Roteiro diário");
                setStartTime(rundown.startTime || "06:00");
                setItems(Array.isArray(rundown.items) ? rundown.items : []);
            })
            .catch((error: unknown) => {
                console.error(error);
                if (!cancelled) setStatus("Não foi possível carregar o roteiro deste dia.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [date]);

    const filteredMedia = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return media;
        return media.filter((item) => item.name.toLowerCase().includes(q));
    }, [media, search]);

    const scheduleTimes = useMemo(() => {
        const result = new Map<string, string>();
        let cursor = timeToSeconds(startTime);
        items.forEach((item) => {
            result.set(item.rundownItemId, secondsToClock(cursor));
            cursor += clipDuration(item);
        });
        return { times: result, end: secondsToClock(cursor) };
    }, [items, startTime]);

    const totalDuration = useMemo(
        () => items.reduce((sum, item) => sum + clipDuration(item), 0),
        [items]
    );

    function addItem(mediaItem: MediaItem) {
        const sourceMediaId = mediaItem.sourceMediaId ?? mediaItem.id;
        setItems((current) => [
            ...current,
            {
                ...mediaItem,
                rundownItemId: `${sourceMediaId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                sourceMediaId,
                blockLabel: mediaItem.blockLabel ?? "",
                watermark: Boolean(mediaItem.watermark),
                hashtag: mediaItem.hashtag ?? "",
                notes: "",
                inPoint: clipIn(mediaItem),
                outPoint: clipOut(mediaItem)
            }
        ]);
        setStatus("");
    }

    function patchItem(id: string, patch: Partial<RundownItem>) {
        setItems((current) => current.map((item) =>
            item.rundownItemId === id ? { ...item, ...patch } : item
        ));
        setStatus("");
    }

    function removeItem(id: string) {
        setItems((current) => current.filter((item) => item.rundownItemId !== id));
        setStatus("");
    }

    function moveItem(sourceId: string, targetId: string) {
        if (sourceId === targetId) return;
        setItems((current) => {
            const from = current.findIndex((item) => item.rundownItemId === sourceId);
            const to = current.findIndex((item) => item.rundownItemId === targetId);
            if (from < 0 || to < 0) return current;
            const copy = [...current];
            const [moved] = copy.splice(from, 1);
            copy.splice(to, 0, moved);
            return copy;
        });
    }

    async function saveRundown(showMessage = true) {
        setLoading(true);
        try {
            const result = await window.santtosAPI.saveDailyRundown({
                date,
                title,
                startTime,
                items
            });
            if (!result?.ok) {
                throw new Error(result?.error || "Falha ao salvar roteiro.");
            }
            const saved: DailyRundown = result.rundown;
            setItems(saved.items ?? []);
            if (showMessage) setStatus("Roteiro salvo.");
            return saved;
        } finally {
            setLoading(false);
        }
    }

    async function applyRundown() {
        try {
            const saved = await saveRundown(false);
            onApply(saved.items);
            setStatus("Roteiro enviado para o Playout.");
        } catch (error) {
            console.error(error);
            setStatus("Não foi possível aplicar o roteiro no Playout.");
        }
    }

    return (
        <section className="opec-shell">
            <header className="opec-header">
                <div>
                    <div className="panel-title">OPEC / SCHEDULER</div>
                    <h1>Roteiro diário</h1>
                    <p>Monte a ordem do dia e envie para o Playout sem alterar o arquivo original.</p>
                </div>
                <div className="opec-header-actions">
                    <button onClick={() => void saveRundown()} disabled={loading}>Salvar roteiro</button>
                    <button className="primary-button" onClick={applyRundown} disabled={loading || items.length === 0}>
                        Aplicar no Playout
                    </button>
                </div>
            </header>

            <div className="opec-meta-row">
                <label><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} /></label>
                <label className="opec-title-field"><span>Nome do roteiro</span><input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={120} /></label>
                <label><span>Início previsto</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} /></label>
                <div className="opec-summary"><span>PROGRAMADO</span><strong>{formatDuration(totalDuration)}</strong><small>até {scheduleTimes.end}</small></div>
            </div>

            {status && <div className="opec-status">{status}</div>}

            <div className="opec-layout">
                <div className="opec-rundown-panel">
                    <div className="opec-section-title">
                        <strong>ROTEIRO</strong>
                        <span>{items.length} item(ns)</span>
                    </div>

                    <div className="opec-rundown-list">
                        {items.length === 0 && <div className="opec-empty">Adicione mídias da biblioteca ao roteiro.</div>}
                        {items.map((item, index) => (
                            <article
                                key={item.rundownItemId}
                                className={`opec-rundown-item ${draggedId === item.rundownItemId ? "dragging" : ""}`}
                                draggable
                                onDragStart={() => setDraggedId(item.rundownItemId)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (draggedId) moveItem(draggedId, item.rundownItemId);
                                    setDraggedId(null);
                                }}
                                onDragEnd={() => setDraggedId(null)}
                            >
                                <div className="opec-order">{index + 1}</div>
                                <div className="opec-entry-time">{scheduleTimes.times.get(item.rundownItemId)}</div>
                                <div className="opec-item-main">
                                    <strong>{item.name}</strong>
                                    <span>{formatDuration(clipDuration(item))}</span>
                                    <div className="opec-item-fields">
                                        <input
                                            placeholder="Bloco / identificação"
                                            value={item.blockLabel ?? ""}
                                            onChange={(e) => patchItem(item.rundownItemId, { blockLabel: e.currentTarget.value })}
                                        />
                                        <input
                                            placeholder="Observação da OPEC"
                                            value={item.notes}
                                            onChange={(e) => patchItem(item.rundownItemId, { notes: e.currentTarget.value })}
                                        />
                                    </div>
                                </div>
                                <div className="opec-item-gc">
                                    <label><input type="checkbox" checked={Boolean(item.watermark)} onChange={(e) => patchItem(item.rundownItemId, { watermark: e.currentTarget.checked })} /> Logo</label>
                                    <input
                                        className="opec-hashtag"
                                        placeholder="#"
                                        value={item.hashtag ?? ""}
                                        onChange={(e) => patchItem(item.rundownItemId, { hashtag: e.currentTarget.value })}
                                    />
                                </div>
                                <button className="opec-remove" title="Remover do roteiro" onClick={() => removeItem(item.rundownItemId)}>×</button>
                            </article>
                        ))}
                    </div>
                </div>

                <aside className="opec-library-panel">
                    <div className="opec-section-title"><strong>BIBLIOTECA</strong><span>{media.length} mídia(s)</span></div>
                    <input className="opec-search" placeholder="Pesquisar mídia..." value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
                    <div className="opec-library-list">
                        {filteredMedia.map((item) => (
                            <article key={item.id} className="opec-library-item">
                                <div><strong>{item.name}</strong><span>{formatDuration(clipDuration(item))} · {item.extension.toUpperCase()}</span></div>
                                <button onClick={() => addItem(item)}>+ Roteiro</button>
                            </article>
                        ))}
                    </div>
                </aside>
            </div>
        </section>
    );
}
