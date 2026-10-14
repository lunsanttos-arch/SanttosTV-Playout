import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { MediaItem, RundownItem } from "./App";
import { normalizeExhibitionType } from "./exhibition";
import { buildPlannedSchedule } from "./timeline-forecast";
import "./opec-scheduler.css";
import { splitRundownItem } from "./rundown-blocks";
import "./library-categories.css";
import StyledDatePicker from "./StyledDatePicker";
import type { LibraryCategory } from "./LibraryFolderSettingsTab";
import RemoteControllerAccess from "./RemoteControllerAccess";

interface DailyRundown {
    date: string;
    title: string;
    startTime: string;
    items: RundownItem[];
    updatedAt?: string | null;
}

interface Props {
    media: MediaItem[];
    remote?: boolean;
    onApply: (
        items: MediaItem[],
        startTime: string
    ) => void;
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


export default function OpecSchedulerPanel({ media, onApply, remote = false }: Props) {
    const [date, setDate] = useState(todayKey());
    const [version, setVersion] = useState<string | null>(null);
    const [title, setTitle] = useState("Programação diária");
    const [startTime, setStartTime] = useState("00:00");
    const [items, setItems] = useState<RundownItem[]>([]);
    const [categories, setCategories] = useState<LibraryCategory[]>([]);
    useEffect(() => { void window.santtosAPI.getLibraryCategories().then(setCategories).catch(() => {}); }, []);
    const [libraryFolder, setLibraryFolder] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [splitId, setSplitId] = useState<string | null>(null);
    const [blockCount, setBlockCount] = useState(2);
    const [draggedId, setDraggedId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setStatus("");

        window.santtosAPI.getDailyRundown(date)
            .then((rundown: DailyRundown) => {
                if (cancelled) return;
                setVersion(rundown.updatedAt ?? null);
                setTitle(rundown.title || "Programação diária");
                setStartTime(rundown.startTime || "00:00");
                setItems(Array.isArray(rundown.items) ? rundown.items : []);
            })
            .catch((error: unknown) => {
                console.error(error);
                if (!cancelled) setStatus("Não foi possível carregar a programação deste dia.");
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
        const category = categories.find(item => item.id === libraryFolder);
        const folder = category?.folderPath?.replace(/\\/g, "/").replace(/\/+$|$/, "/");
        const scoped = libraryFolder ? (folder ? media.filter(item => item.path.replace(/\\/g, "/").toLowerCase().startsWith(folder.toLowerCase())) : []) : media;
        if (!q) return scoped;
        return scoped.filter((item) => item.name.toLowerCase().includes(q));
    }, [media, search, libraryFolder, categories]);

    // Roteiro = hora PROGRAMADA. A timeline calcula a entrada ESTIMADA
    // de acordo com a reprodução real, pausa e sinal NDI.
    const scheduleTimes = useMemo(() =>
        buildPlannedSchedule(
            items.map(item => ({ ...item, id: item.rundownItemId })),
            startTime
        ), [items, startTime]
    );
    const totalDuration = scheduleTimes.totalSeconds;

    function addItem(mediaItem: MediaItem, beforeId?: string) {
        const sourceMediaId = mediaItem.sourceMediaId ?? mediaItem.id;
        setItems((current) => {
            const added = {
                ...mediaItem,
                rundownItemId: `${sourceMediaId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                sourceMediaId,
                blockLabel: mediaItem.blockLabel ?? "",
                exhibitionType: normalizeExhibitionType(mediaItem.exhibitionType),
                watermark: Boolean(mediaItem.watermark),
                hashtag: mediaItem.hashtag ?? "",
                notes: "",
                inPoint: clipIn(mediaItem),
                outPoint: clipOut(mediaItem)
            };
            const copy = [...current];
            const position = beforeId ? copy.findIndex(item => item.rundownItemId === beforeId) : -1;
            copy.splice(position < 0 ? copy.length : position, 0, added);
            return copy;
        });
        setStatus("");
    }

    function dropItem(event: DragEvent, target?: RundownItem) {
        event.preventDefault(); event.stopPropagation();
        const mediaId = event.dataTransfer.getData("application/x-santtos-media");
        const source = media.find(item => item.id === mediaId);
        if (source) {
            if (target?.placeholder) patchItem(target.rundownItemId, { ...source, sourceMediaId: source.id,
                placeholder: false, inPoint: clipIn(source), outPoint: clipOut(source) });
            else addItem(source, target?.rundownItemId);
        } else {
            const id = event.dataTransfer.getData("application/x-santtos-rundown") || draggedId;
            if (id && target) moveItem(id, target.rundownItemId);
            else if (id) setItems(current => [...current.filter(item => item.rundownItemId !== id),
                ...current.filter(item => item.rundownItemId === id)]);
        }
        setDraggedId(null); setDropTarget(null);
    }

    function patchItem(id: string, patch: Partial<RundownItem>) {
        setItems((current) => current.map((item) =>
            item.rundownItemId === id ? { ...item, ...patch } : item
        ));
        setStatus("");
    }

    function splitItem(item: RundownItem) {
        try {
            const blocks = splitRundownItem(item, blockCount, () => crypto.randomUUID());
            setItems(current => current.flatMap(entry => entry.rundownItemId === item.rundownItemId ? blocks : [entry]));
            setSplitId(null);
            setStatus(`${blocks.length} blocos criados. A duração total foi preservada.`);
        } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível dividir."); }
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
            copy.splice(from < to ? to - 1 : to, 0, moved);
            return copy;
        });
        setStatus("");
    }

    async function saveRundown(showMessage = true) {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
            setStatus("Defina a hora inicial da programação antes de salvar.");
            throw new Error("Hora inicial inválida.");
        }
        setLoading(true);
        try {
            const result = await window.santtosAPI.saveDailyRundown({
                date,
                expectedUpdatedAt: version,
                title,
                startTime,
                items
            });
            if (!result?.ok) {
                throw new Error(result?.error || "Falha ao salvar roteiro.");
            }
            const saved: DailyRundown = result.rundown;
            setVersion(saved.updatedAt ?? null);
            setItems(saved.items ?? []);
            if (showMessage) setStatus("Programação salva.");
            return saved;
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Não foi possível salvar.");
            throw error;
        } finally {
            setLoading(false);
        }
    }

    async function applyRundown() {
        try {
            if (items.some(item => item.placeholder)) { setStatus("Substitua os conteúdos a definir antes de aplicar a programação."); return; }
            const saved = await saveRundown(false);
            onApply(
                saved.items,
                saved.startTime || "00:00"
            );
            setStatus("Programação aplicada ao Playout.");
        } catch (error) {
            console.error(error);
            setStatus("Não foi possível aplicar a programação no Playout.");
        }
    }

    return (
        <section className="opec-shell">
            <header className="opec-header">
                <div>
                    <div className="panel-title">PROGRAMAÇÃO</div>
                    <h1>Programação diária</h1>
                    <p>Monte a programação do dia e envie para o Playout sem alterar as mídias originais. Os horários aqui são programados; a previsão ao vivo aparece na Timeline.</p>
                </div>
                <div className="opec-header-actions">
                    <button disabled={loading} onClick={() => void window.santtosAPI.getDailyRundown(date).then(rundown => {
                        setItems(rundown.items ?? []); setTitle(rundown.title); setStartTime(rundown.startTime); setVersion(rundown.updatedAt ?? null); setStatus("Programação atualizada.");
                    }).catch(() => setStatus("Não foi possível atualizar."))}>Atualizar programação</button>
                    <button onClick={() => void saveRundown().catch(() => {})} disabled={loading}>Salvar programação</button>
                    <button hidden={remote} className="primary-button" onClick={applyRundown} disabled={loading || items.length === 0}>
                        Aplicar no Playout
                    </button>
                </div>
            </header>

            {!remote && <RemoteControllerAccess />}
            <div className="opec-meta-row">
                <label><span>Data</span><StyledDatePicker value={date} onChange={setDate} /></label>
                <label className="opec-title-field"><span>Nome da programação</span><input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={120} /></label>
                <label><span>Início programado</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} /></label>
                <div className="opec-summary"><span>PROGRAMADO</span><strong>{totalDuration === null ? "--:--:--" : formatDuration(totalDuration)}</strong><small>até {scheduleTimes.end}</small></div>
            </div>

            {status && <div className="opec-status">{status}</div>}

            <div className="opec-layout">
                <div className="opec-rundown-panel">
                    <div className="opec-section-title">
                        <strong>PROGRAMAÇÃO</strong>
                        <span>{items.length} item(ns)</span>
                    </div>

                    <button onClick={() => setItems(current => [...current, { id: "placeholder", sourceMediaId: "", rundownItemId: `slot-${Date.now()}-${Math.random()}`,
                        placeholder: true, name: "Conteúdo a definir", path: "", extension: "VAZIO", fileSize: 0, duration: 1800, outPoint: 1800,
                        notes: "", width: null, height: null, fps: null, videoCodec: null, audioCodec: null, thumbnail: null,
                        status: "placeholder", createdAt: new Date().toISOString() }])}>+ Conteúdo a definir</button>
                    <div className={`opec-rundown-list ${dropTarget === "end" ? "drop-active" : ""}`}
                        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = draggedId ? "move" : "copy"; }}
                        onDrop={event => dropItem(event)}>
                        {items.length === 0 && <div className="opec-empty">Arraste mídias das pastas da biblioteca para a programação.</div>}
                        {items.map((item, index) => (
                            <article
                                key={item.rundownItemId}
                                className={`opec-rundown-item ${item.placeholder ? "opec-pending-item" : ""} ${draggedId === item.rundownItemId ? "dragging" : ""} ${dropTarget === item.rundownItemId ? "drop-active" : ""}`}
                                draggable
                                onDragStart={event => {
                                    if ((event.target as HTMLElement).closest("input, select, button")) { event.preventDefault(); return; }
                                    event.dataTransfer.setData("application/x-santtos-rundown", item.rundownItemId);
                                    event.dataTransfer.setData("text/plain", item.name);
                                    event.dataTransfer.effectAllowed = "move";
                                    setDraggedId(item.rundownItemId);
                                }}
                                onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDropTarget(item.rundownItemId); }}
                                onDrop={event => dropItem(event, item)}
                                onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}
                            >
                                <div className="opec-order" title="Arrastar para reordenar"><span className="opec-drag-handle">⠿</span>{index + 1}</div>
                                <div className="opec-entry-time">{scheduleTimes.times.get(item.rundownItemId)}</div>
                                <div className="opec-item-main">
                                    {item.placeholder && <span className="opec-pending-label">A DEFINIR</span>}
                                    {item.placeholder ? <input className="opec-placeholder-name" aria-label="Nome do espaço" value={item.name}
                                        onChange={event => patchItem(item.rundownItemId, { name: event.currentTarget.value })} /> : <strong title={item.name}>{item.name}</strong>}
                                    <div className="opec-item-fields">
                                        <input
                                            placeholder="Identificação"
                                            aria-label={`Identificação de ${item.name}`}
                                            value={item.blockLabel ?? ""}
                                            onChange={(e) => patchItem(item.rundownItemId, { blockLabel: e.currentTarget.value })}
                                        />
                                        <input
                                            placeholder="Observação"
                                            aria-label={`Observação de ${item.name}`}
                                            value={item.notes}
                                            onChange={(e) => patchItem(item.rundownItemId, { notes: e.currentTarget.value })}
                                        />
                                    </div>
                                </div>
                                <div className="opec-block-tools">
                                    <span>{formatDuration(clipDuration(item))}</span>
                                    {!item.placeholder && <>
                                        <label>IN <input type="number" step="0.01" min="0" max={clipOut(item)} aria-label={`Entrada em segundos de ${item.name}`}
                                            value={clipIn(item)} onChange={event => { const value = Number(event.currentTarget.value);
                                                if (Number.isFinite(value) && value >= 0 && value < clipOut(item)) patchItem(item.rundownItemId, { inPoint: value }); }} /></label>
                                        <label>OUT <input type="number" step="0.01" min={clipIn(item)} max={item.duration || undefined} aria-label={`Saída em segundos de ${item.name}`}
                                            value={clipOut(item)} onChange={event => { const value = Number(event.currentTarget.value);
                                                if (Number.isFinite(value) && value > clipIn(item) && value <= (item.duration || 0)) patchItem(item.rundownItemId, { outPoint: value }); }} /></label>
                                    </>}
                                    {item.placeholder && <label>Minutos <input type="number" min="0.016667" max="1440" step="0.5"
                                        aria-label={`Duração em minutos de ${item.name}`} value={Number((clipDuration(item) / 60).toFixed(4))}
                                        onChange={event => { const seconds = Number(event.currentTarget.value) * 60;
                                            if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400)
                                                patchItem(item.rundownItemId, { duration: seconds, inPoint: 0, outPoint: seconds }); }} /></label>}
                                    <button hidden={Boolean(item.placeholder)} disabled={clipDuration(item) < 2} onClick={() => { setSplitId(splitId === item.rundownItemId ? null : item.rundownItemId); setBlockCount(2); }}>Dividir em blocos</button>
                                    {splitId === item.rundownItemId && <>
                                        <input type="number" min="2" max="100" aria-label="Quantidade de blocos" value={blockCount}
                                            onChange={event => setBlockCount(Number(event.currentTarget.value))} />
                                        <button onClick={() => splitItem(item)}>Dividir</button>
                                        <button onClick={() => setSplitId(null)}>Cancelar</button>
                                    </>}
                                </div>
                                <button className="opec-remove" title="Remover da programação" onClick={() => removeItem(item.rundownItemId)}>×</button>
                            </article>
                        ))}
                        {items.length > 0 && <div className="opec-drop-end"
                            onDragOver={event => { event.preventDefault(); setDropTarget("end"); }}
                            onDrop={event => dropItem(event)}>Solte aqui para adicionar ao final</div>}
                    </div>
                </div>

                <aside className="opec-library-panel">
                    <div className="opec-section-title"><strong>BIBLIOTECA</strong><span>{media.length} mídia(s)</span></div>
                    <div className="library-category-tabs opec-folder-tabs" role="tablist" aria-label="Pastas da biblioteca">
                        <button role="tab" aria-selected={libraryFolder === ""} className={libraryFolder === "" ? "active" : ""}
                            onClick={() => setLibraryFolder("")}>Todas</button>
                        {categories.map(category => <button key={category.id} role="tab" aria-selected={libraryFolder === category.id}
                            className={libraryFolder === category.id ? "active" : ""} title={category.folderPath || "Pasta não configurada"}
                            onClick={() => setLibraryFolder(category.id)}>{category.name}</button>)}
                    </div>
                    <p className="opec-library-hint">Arraste para inserir, reordenar ou substituir um conteúdo a definir.</p>
                    <input className="opec-search" placeholder="Pesquisar mídia..." value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
                    <div className="opec-library-list">
                        {filteredMedia.length === 0 && <div className="opec-empty">Nenhuma mídia nesta pasta.</div>}
                        {filteredMedia.map((item) => (
                            <article key={item.id} className="opec-library-item" draggable
                                onDragStart={event => {
                                    if ((event.target as HTMLElement).closest("button")) { event.preventDefault(); return; }
                                    event.dataTransfer.setData("application/x-santtos-media", item.id);
                                    event.dataTransfer.setData("text/plain", item.name);
                                    event.dataTransfer.effectAllowed = "copy";
                                }} onDragEnd={() => setDropTarget(null)}>
                                <div><strong>{item.name}</strong><span>{formatDuration(clipDuration(item))} · {item.extension.toUpperCase()}</span></div>
                                <button onClick={() => addItem(item)}>+ Programação</button>
                            </article>
                        ))}
                    </div>
                </aside>
            </div>
        </section>
    );
}
