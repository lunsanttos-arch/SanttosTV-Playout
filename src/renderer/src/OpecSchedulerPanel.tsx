import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent } from "react";
import { FilmBlockEditor, type MediaItem, type RundownItem } from "./App";
import { normalizeExhibitionType } from "./exhibition";
import { buildPlannedSchedule } from "./timeline-forecast";
import "./opec-scheduler.css";
import { placeRundownBlocks, rundownDraftReducer, type BlockRange } from "./rundown-blocks";
import "./library-categories.css";
import StyledDatePicker from "./StyledDatePicker";
import type { LibraryCategory } from "./LibraryFolderSettingsTab";
import RemoteControllerAccess from "./RemoteControllerAccess";

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

interface DailyRundown {
    date: string;
    title: string;
    startTime: string;
    items: RundownItem[];
    updatedAt?: string | null;
    missingItems?: number;
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


function SlotMinutes({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
    const formatted = Number((seconds / 60).toFixed(4)).toString();
    const [text, setText] = useState(formatted);
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setText(formatted); }, [formatted]);
    return <input type="number" min="0.016667" max="1440" step="any" aria-label="Duração em minutos"
        value={text} onFocus={() => { focused.current = true; }} onChange={event => {
            const value = event.currentTarget.value; setText(value);
            const next = Number(value) * 60;
            if (value !== "" && Number.isFinite(next) && next >= 1 && next <= 86400) onChange(next);
        }} onBlur={() => { focused.current = false; setText(formatted); }} />;
}


export default function OpecSchedulerPanel({ media, onApply, remote = false }: Props) {
    const [date, setDate] = useState(todayKey());
    const [version, setVersion] = useState<string | null>(null);
    const [draft, dispatchDraft] = useReducer(rundownDraftReducer, { items: [], history: [], meta: { title: "Programação diária", startTime: "00:00" } });
    const title = draft.meta?.title ?? "Programação diária", startTime = draft.meta?.startTime ?? "00:00";
    const setTitle = (title: string) => dispatchDraft({ type: "meta", meta: { title, startTime } });
    const setStartTime = (startTime: string) => dispatchDraft({ type: "meta", meta: { title, startTime } });
    const items = draft.items;
    const setItems = (update: RundownItem[] | ((items: RundownItem[]) => RundownItem[])) => dispatchDraft({ type: "edit", update });
    const loadItems = (items: RundownItem[], meta?: { title: string; startTime: string }) => dispatchDraft({ type: "load", items, meta });
    const [categories, setCategories] = useState<LibraryCategory[]>([]);
    useEffect(() => { void window.santtosAPI.getLibraryCategories().then(setCategories).catch(() => {}); }, []);
    const [libraryFolder, setLibraryFolder] = useState("");
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [splitError, setSplitError] = useState("");
    const [editingFilm, setEditingFilm] = useState<RundownItem | null>(null);
    const [pendingDrop, setPendingDrop] = useState<{ source: MediaItem; targetId: string } | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [importKind, setImportKind] = useState<"weekday" | "date">("weekday");
    const [weekday, setWeekday] = useState(() => new Date(`${todayKey()}T12:00:00`).getDay());
    const [sourceDate, setSourceDate] = useState(todayKey());
    const [importMode, setImportMode] = useState<"replace" | "append">("replace");
    const [modelAction, setModelAction] = useState<"import" | "save">("import");
    const [modelPreview, setModelPreview] = useState<Awaited<ReturnType<typeof window.santtosAPI.getWeeklyRundown>> | null>(null);
    const [modalError, setModalError] = useState("");
    const [modelLoading, setModelLoading] = useState(false);
    useEffect(() => {
        if (!importOpen || importKind !== "weekday") return;
        let canceled = false; setModelPreview(null); setModelLoading(true); setModalError("");
        void window.santtosAPI.getWeeklyRundown(weekday).then(result => { if (!canceled) setModelPreview(result); })
            .catch(error => { if (!canceled) { setStatus(error.message); setModalError(error.message); } }).finally(() => { if (!canceled) setModelLoading(false); });
        return () => { canceled = true; };
    }, [importOpen, importKind, weekday]);
    const [draggedId, setDraggedId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setStatus("");

        window.santtosAPI.getDailyRundown(date)
            .then((rundown: DailyRundown) => {
                if (cancelled) return;
                setVersion(rundown.updatedAt ?? null);
                loadItems(Array.isArray(rundown.items) ? rundown.items : [], { title: rundown.title || "Programação diária", startTime: rundown.startTime || "00:00" });
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
                replacedPlaceholder: false,
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
            if (target) setPendingDrop({ source, targetId: target.rundownItemId });
            else addItem(source);

        } else {
            const id = event.dataTransfer.getData("application/x-santtos-rundown") || draggedId;
            if (id && target) moveItem(id, target.rundownItemId);
            else if (id) setItems(current => [...current.filter(item => item.rundownItemId !== id),
                ...current.filter(item => item.rundownItemId === id)]);
        }
        setDraggedId(null); setDropTarget(null);
    }

    function resolveDrop(replace: boolean) {
        if (!pendingDrop) return;
        const target = items.find(item => item.rundownItemId === pendingDrop.targetId);
        if (!target) { setPendingDrop(null); return; }
        const source = pendingDrop.source;
        if (replace) patchItem(target.rundownItemId, { ...source, sourceMediaId: source.id, placeholder: false,
            liveSlot: false, replacedPlaceholder: target.placeholder || target.replacedPlaceholder === true,
            blockLabel: target.blockLabel || "", notes: target.notes || "", inPoint: clipIn(source), outPoint: clipOut(source) });
        else addItem(source, target.rundownItemId);
        setPendingDrop(null);
    }

    async function exportRoteiro(format: "pdf" | "html") {
        setLoading(true);
        try {
            const result = await (format === "pdf" ? window.santtosAPI.exportRundownPdf : window.santtosAPI.exportRundownHtml)({ date, title, startTime, items });
            if (!result.ok) throw Error(result.error || "Não foi possível exportar o roteiro.");
            if (!result.canceled) setStatus(`Roteiro exportado em ${format.toUpperCase()}.`);
        } catch (error) { setStatus(error instanceof Error ? error.message : "Não foi possível exportar o roteiro."); }
        finally { setLoading(false); }
    }

    async function useModel() {
        setLoading(true); setModalError("");
        try {
            if (modelAction === "save") {
                if (!modelPreview) throw Error("Aguarde o carregamento do modelo.");
                const result = await window.santtosAPI.saveWeeklyRundown(weekday, { title, startTime, items, expectedUpdatedAt: modelPreview.updatedAt ?? null });
                if (!result.ok) throw Error(result.error || "Não foi possível salvar o modelo.");
                setStatus(`Modelo de ${WEEKDAYS[weekday]} salvo.`);
            } else {
                const source = importKind === "date" ? await window.santtosAPI.getDailyRundown(sourceDate) : modelPreview;
                if (!source || ("exists" in source && !source.exists) || !source.items.length) throw Error("A origem não tem programação salva.");
                if (source.missingItems) throw Error("Há materiais da origem ausentes na biblioteca. Recupere-os antes de importar.");
                const imported = source.items.map((item, index) => ({ ...item, rundownItemId: `import-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}` }));
                dispatchDraft({ type: "import", items: importMode === "append" ? [...items, ...imported] : imported,
                    meta: importMode === "append" ? { title, startTime } : { title: source.title, startTime: source.startTime } });
                setStatus("Programação importada. Revise e salve para confirmar. Desfazer restaura a programação anterior.");
            }
            setImportOpen(false);
        } catch (error) { const message = error instanceof Error ? error.message : "Não foi possível importar."; setStatus(message); setModalError(message); }
        finally { setLoading(false); }
    }

    function patchItem(id: string, patch: Partial<RundownItem>) {
        setItems((current) => current.map((item) =>
            item.rundownItemId === id ? { ...item, ...patch } : item
        ));
        setStatus("");
    }

    function splitItem(sourceId: string, ranges: BlockRange[]) {
        try {
            setItems(placeRundownBlocks(items, sourceId, ranges));
            setEditingFilm(null);
            setStatus(`${ranges.length} blocos encaixados nas lacunas. Os demais itens foram mantidos.`);
        } catch (error) { setSplitError(error instanceof Error ? error.message : "Não foi possível dividir."); }
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
            dispatchDraft({ type: "normalize", items: saved.items ?? [] });
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
            if (items.some(item => item.placeholder && !item.liveSlot)) { setStatus("Substitua os conteúdos a definir antes de aplicar a programação."); return; }
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
                    <button disabled={loading || !draft.history.length} onClick={() => { dispatchDraft({ type: "undo" }); setEditingFilm(null); setStatus("Última alteração desfeita. Salve para atualizar a programação."); }}>Desfazer</button>
                    <button disabled={loading} onClick={() => void window.santtosAPI.getDailyRundown(date).then(rundown => {
                        loadItems(rundown.items ?? [], { title: rundown.title, startTime: rundown.startTime }); setVersion(rundown.updatedAt ?? null); setStatus("Programação atualizada.");
                    }).catch(() => setStatus("Não foi possível atualizar."))}>Atualizar programação</button>
                    <button disabled={loading} onClick={() => void exportRoteiro("pdf")}>PDF do roteiro</button>
                    <button disabled={loading} onClick={() => void exportRoteiro("html")}>HTML do roteiro</button>
                    <button disabled={loading} onClick={() => { setModalError(""); setModelAction("save"); setImportKind("weekday"); setWeekday(new Date(`${date}T12:00:00`).getDay()); setImportOpen(true); }}>Criar modelo semanal</button>
                    <button disabled={loading} onClick={() => { setModalError(""); setModelAction("import"); setImportKind("weekday"); setWeekday(new Date(`${date}T12:00:00`).getDay()); setImportOpen(true); }}>Importar programação</button>
                    <button onClick={() => void saveRundown().catch(() => {})} disabled={loading}>Salvar programação</button>
                    <button hidden={remote} className="primary-button" onClick={applyRundown} disabled={loading || items.length === 0}>
                        Aplicar no Playout
                    </button>
                </div>
            </header>

            {pendingDrop && <div className="opec-modal-backdrop" onKeyDown={event => { if (event.key === "Escape") setPendingDrop(null); }}>
                <section className="opec-modal" role="dialog" aria-modal="true" aria-label="Arrastar material para o roteiro">
                    <h2>{pendingDrop.source.name}</h2><p>Como colocar este material no roteiro?</p>
                    <div className="opec-modal-actions"><button autoFocus onClick={() => resolveDrop(true)}>Substituir item</button>
                        <button onClick={() => resolveDrop(false)}>Incluir antes deste item</button><button onClick={() => setPendingDrop(null)}>Cancelar</button></div>
                </section>
            </div>}
            {importOpen && <div className="opec-modal-backdrop" onKeyDown={event => { if (event.key === "Escape" && !loading) setImportOpen(false); }}>
                <section className="opec-modal" role="dialog" aria-modal="true" aria-label={modelAction === "save" ? "Criar modelo semanal" : "Importar programação"}>
                    <h2>{modelAction === "save" ? "Modelo semanal" : "Importar programação"}</h2>
                    {modalError && <p className="opec-modal-error" role="alert">{modalError}</p>}
                    {modelAction === "import" && <label>Origem<select value={importKind} onChange={event => setImportKind(event.currentTarget.value as "weekday" | "date")}>
                        <option value="weekday">Modelo do dia da semana</option><option value="date">Programação de outra data</option></select></label>}
                    {importKind === "weekday" ? <><label>Dia da semana<select value={weekday} onChange={event => setWeekday(Number(event.currentTarget.value))}>
                        {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
                        <p>{modelLoading ? "Carregando modelo..." : modelPreview?.exists ? `${modelPreview.title} · ${modelPreview.items.length} itens · ${modelPreview.startTime}` : "Nenhum modelo salvo para este dia."}</p>
                        {modelAction === "save" && <p>{modelPreview?.exists ? "Salvar substituirá o modelo existente desse dia." : "O roteiro atual será salvo como modelo desse dia."}</p>}</>
                        : <label>Data de origem<StyledDatePicker value={sourceDate} onChange={setSourceDate} /></label>}
                    {modelAction === "import" && <label>Destino<select value={importMode} onChange={event => setImportMode(event.currentTarget.value as "replace" | "append")}>
                        <option value="replace">Substituir roteiro atual</option><option value="append">Acrescentar ao final</option></select>
                        <small>A data atual será mantida. Ao substituir, o nome e a hora inicial vêm da origem.</small></label>}
                    <div className="opec-modal-actions"><button autoFocus disabled={loading || (importKind === "weekday" && (modelLoading || !modelPreview))}
                        onClick={() => void useModel()}>{modelAction === "save" ? "Salvar modelo" : "Importar"}</button>
                        <button disabled={loading} onClick={() => setImportOpen(false)}>Cancelar</button></div>
                </section>
            </div>}

            {!remote && <RemoteControllerAccess />}
            <div className="opec-meta-row">
                <label><span>Data</span><StyledDatePicker value={date} onChange={setDate} /></label>
                <label className="opec-title-field"><span>Nome da programação</span><input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={120} /></label>
                <label><span>Início programado</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} /></label>
                <div className="opec-summary"><span>PROGRAMADO</span><strong>{totalDuration === null ? "--:--:--" : formatDuration(totalDuration)}</strong><small>até {scheduleTimes.end}</small></div>
            </div>

            {status && <div className="opec-status">{status}</div>}

            {editingFilm && <FilmBlockEditor item={editingFilm} errorMessage={splitError} onClose={() => setEditingFilm(null)}
                onSaveEdit={(id, inPoint, outPoint) => { patchItem(id, { inPoint, outPoint }); setEditingFilm(null); }}
                onSplit={splitItem} />}

            <div className="opec-layout">
                <div className="opec-rundown-panel">
                    <div className="opec-section-title">
                        <strong>PROGRAMAÇÃO</strong>
                        <span>{items.length} item(ns)</span>
                    </div>

                    <button onClick={() => setItems(current => [...current, { id: "placeholder", sourceMediaId: "", rundownItemId: `slot-${Date.now()}-${Math.random()}`,
                        placeholder: true, name: "", path: "", extension: "VAZIO", fileSize: 0, duration: 1800, outPoint: 1800,
                        notes: "", width: null, height: null, fps: null, videoCodec: null, audioCodec: null, thumbnail: null,
                        status: "placeholder", createdAt: new Date().toISOString() }])}>+ Conteúdo a definir</button>
                    <div className={`opec-rundown-list ${dropTarget === "end" ? "drop-active" : ""}`}
                        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = draggedId ? "move" : "copy"; }}
                        onDrop={event => dropItem(event)}>
                        {items.length === 0 && <div className="opec-empty">Arraste mídias das pastas da biblioteca para a programação.</div>}
                        {items.map((item, index) => (
                            <article
                                key={item.rundownItemId}
                                className={`opec-rundown-item ${item.placeholder && !item.liveSlot ? "opec-pending-item" : ""} ${draggedId === item.rundownItemId ? "dragging" : ""} ${dropTarget === item.rundownItemId ? "drop-active" : ""}`}
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
                                    {item.placeholder && <span className="opec-pending-label">{item.liveSlot ? "AO VIVO · AVANÇO MANUAL" : "A DEFINIR"}</span>}
                                    {item.placeholder ? <input className="opec-placeholder-name" aria-label="Nome do espaço" placeholder="Conteúdo a definir" value={item.name}
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
                                    {item.placeholder && <>
                                        <button type="button" aria-pressed={item.liveSlot === true} className={item.liveSlot ? "opec-live-active" : ""}
                                            onClick={() => patchItem(item.rundownItemId, { liveSlot: !item.liveSlot })}>Ao Vivo</button>
                                        <label>Minutos <SlotMinutes seconds={clipDuration(item)} onChange={seconds =>
                                            patchItem(item.rundownItemId, { duration: seconds, inPoint: 0, outPoint: seconds })} /></label>
                                    </>}
                                    {!remote && !item.placeholder && item.replacedPlaceholder && <button
                                        disabled={clipDuration(item) < 1} onClick={() => { setSplitError(""); setEditingFilm({ ...item, id: item.rundownItemId }); }}>Dividir em blocos</button>}
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
