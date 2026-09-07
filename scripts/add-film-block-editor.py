from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)

# --- App.tsx ---
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

# Media item clip metadata
old = '''    hashtag?: string;\n    name: string;'''
new = '''    hashtag?: string;\n    inPoint?: number;\n    outPoint?: number | null;\n    blockLabel?: string;\n    name: string;'''
t = replace_once(t, old, new, "MediaItem clip metadata")

# Engine overlay clip end
old = '''                    timingMode?: string;\n                }'''
new = '''                    timingMode?: string;\n                    outPointSeconds?: number | null;\n                }'''
t = replace_once(t, old, new, "playNdi overlay outpoint type")

# State for editor + transition guard
old = '''    const [watermarkPreviewUrl, setWatermarkPreviewUrl] =\n        useState(\"\");'''
new = '''    const [watermarkPreviewUrl, setWatermarkPreviewUrl] =\n        useState(\"\");\n    const [editingFilm, setEditingFilm] =\n        useState<MediaItem | null>(null);\n    const clipAdvanceGuardRef = useRef(false);'''
t = replace_once(t, old, new, "film editor state")

# Preserve in/out during media metadata reconciliation
old = '''                        loop: Boolean(entry.loop),\n                        watermark: Boolean(entry.watermark),\n                        hashtag: entry.hashtag ?? \"\"'''
new = '''                        loop: Boolean(entry.loop),\n                        watermark: Boolean(entry.watermark),\n                        hashtag: entry.hashtag ?? \"\",\n                        inPoint: normalizeClipPoint(entry.inPoint, 0),\n                        outPoint: normalizeClipOutPoint(\n                            entry.outPoint,\n                            source.duration\n                        ),\n                        blockLabel: entry.blockLabel ?? \"\"'''
t = replace_once(t, old, new, "reconcile clip points")

# Derive clip timing before preview opacity
anchor = '''    const watermarkFadeSeconds = Math.max(\n        0,\n        watermarkStyle.fadeMs / 1000\n    );'''
insert = '''    const selectedClipIn = getClipIn(selectedMedia);\n    const selectedClipOut = getClipOut(selectedMedia);\n    const selectedClipDuration = getClipDuration(selectedMedia);\n    const selectedClipCurrent = Math.max(\n        0,\n        currentTime - selectedClipIn\n    );\n\n'''+anchor
t = replace_once(t, anchor, insert, "selected clip timing")

# Overlay preview should use clip-relative timing
old = '''            currentTime,\n            duration,\n            fadeSeconds:\n                watermarkFadeSeconds'''
new = '''            currentTime: selectedClipCurrent,\n            duration: selectedClipDuration,\n            fadeSeconds:\n                watermarkFadeSeconds'''
t = replace_once(t, old, new, "watermark clip preview")
old = '''            currentTime,\n            duration,\n            fadeSeconds: 0.2'''
new = '''            currentTime: selectedClipCurrent,\n            duration: selectedClipDuration,\n            fadeSeconds: 0.2'''
t = replace_once(t, old, new, "hashtag clip preview")

# Progress percentage clip-relative
old = '''    const progressPercent =\n        duration > 0\n            ? Math.min(\n                  100,\n                  Math.max(\n                      0,\n                      (currentTime / duration) * 100\n                  )\n              )\n            : 0;'''
new = '''    const progressPercent =\n        selectedClipDuration > 0\n            ? Math.min(\n                  100,\n                  Math.max(\n                      0,\n                      (selectedClipCurrent / selectedClipDuration) * 100\n                  )\n              )\n            : 0;'''
t = replace_once(t, old, new, "clip progress")

# Timeline clock calculation should use clip duration
old = '''                const itemDuration =\n                    index === 0 &&\n                    selectedMediaIndex >= 0\n                        ? duration || item.duration || 0\n                        : item.duration || 0;'''
new = '''                const itemDuration =\n                    index === 0 &&\n                    selectedMediaIndex >= 0\n                        ? Math.max(\n                              0,\n                              getClipDuration(item) -\n                                  selectedClipCurrent\n                          )\n                        : getClipDuration(item);'''
t = replace_once(t, old, new, "timeline clip duration")

# Load selected media at in point, not zero
old = '''        video.pause();\n        video.currentTime = 0;\n        video.load();\n        setCurrentTime(0);'''
new = '''        video.pause();\n        video.load();\n        const inPoint = getClipIn(selectedMedia);\n        try {\n            video.currentTime = inPoint;\n        } catch {\n            // loadedmetadata will apply IN again.\n        }\n        setCurrentTime(inPoint);\n        clipAdvanceGuardRef.current = false;'''
t = replace_once(t, old, new, "load at clip in")

# Overlay state duration/outpoint
old = '''            durationSeconds:\n                mediaItem.duration ?? 0,'''
new = '''            durationSeconds:\n                getClipOut(mediaItem),\n            outPointSeconds:\n                getClipOut(mediaItem),'''
t = replace_once(t, old, new, "overlay clip out")

# Safe play position within clip
old = '''        try {\n            await startNativeNdi(\n                mediaToPlay,\n                video.currentTime || 0\n            );'''
new = '''        try {\n            const clipIn = getClipIn(mediaToPlay);\n            const clipOut = getClipOut(mediaToPlay);\n            if (\n                !Number.isFinite(video.currentTime) ||\n                video.currentTime < clipIn ||\n                video.currentTime >= clipOut\n            ) {\n                video.currentTime = clipIn;\n            }\n            await startNativeNdi(\n                mediaToPlay,\n                video.currentTime || clipIn\n            );'''
t = replace_once(t, old, new, "play within clip")

# Stop resets to IN
old = '''            video.pause();\n            video.currentTime = 0;\n        }\n\n        setCurrentTime(0);'''
new = '''            video.pause();\n            const inPoint = getClipIn(selectedMedia);\n            video.currentTime = inPoint;\n        }\n\n        setCurrentTime(getClipIn(selectedMedia));'''
t = replace_once(t, old, new, "stop resets in")

# Loop resets to IN
old = '''            video.currentTime = 0;\n            await startNativeNdi(\n                selectedMedia,\n                0,\n                true'''
new = '''            const clipIn = getClipIn(selectedMedia);\n            video.currentTime = clipIn;\n            await startNativeNdi(\n                selectedMedia,\n                clipIn,\n                true'''
t = replace_once(t, old, new, "loop clip in")

# Next media starts at IN
old = '''        onSelectMedia(nextMedia);\n        setCurrentTime(0);\n        setDuration(0);'''
new = '''        onSelectMedia(nextMedia);\n        setCurrentTime(getClipIn(nextMedia));\n        setDuration(getClipDuration(nextMedia));\n        clipAdvanceGuardRef.current = false;'''
t = replace_once(t, old, new, "next clip state")
old = '''        await startNativeNdi(nextMedia, 0);'''
new = '''        const nextIn = getClipIn(nextMedia);\n        video.currentTime = nextIn;\n        await startNativeNdi(nextMedia, nextIn);'''
t = replace_once(t, old, new, "next clip native")

# Add clip-aware time handler before handleSeeked
anchor = '''    async function handleSeeked(\n        video: HTMLVideoElement\n    ) {'''
handler = '''    async function handleProgramTimeUpdate(\n        video: HTMLVideoElement\n    ) {\n        setCurrentTime(video.currentTime);\n\n        if (!selectedMedia) {\n            return;\n        }\n\n        const outPoint = getClipOut(selectedMedia);\n        if (\n            video.currentTime >= outPoint - 0.035 &&\n            !clipAdvanceGuardRef.current\n        ) {\n            clipAdvanceGuardRef.current = true;\n            await playNextMedia();\n        }\n    }\n\n'''+anchor
t = replace_once(t, anchor, handler, "clip out time handler")

# Clamp seek within clip
old = '''        setCurrentTime(video.currentTime);\n\n        if (!isPlaying || !selectedMedia) {'''
new = '''        if (selectedMedia) {\n            const inPoint = getClipIn(selectedMedia);\n            const outPoint = getClipOut(selectedMedia);\n            if (video.currentTime < inPoint) {\n                video.currentTime = inPoint;\n                return;\n            }\n            if (video.currentTime >= outPoint) {\n                video.currentTime = Math.max(\n                    inPoint,\n                    outPoint - 0.04\n                );\n                return;\n            }\n        }\n\n        setCurrentTime(video.currentTime);\n\n        if (!isPlaying || !selectedMedia) {'''
t = replace_once(t, old, new, "seek clip clamp")

# New timeline item default clip fields
old = '''            loop: false,\n            watermark: false,\n            hashtag: \"\"'''
new = '''            loop: false,\n            watermark: false,\n            hashtag: \"\",\n            inPoint: 0,\n            outPoint: mediaItem.duration ?? null,\n            blockLabel: \"\"'''
t = replace_once(t, old, new, "new clip defaults")

# Film edit/split methods before cutQueueTo
anchor = '''    function cutQueueTo(mediaId: string) {'''
methods = '''    function applyFilmEdit(\n        mediaId: string,\n        inPoint: number,\n        outPoint: number\n    ) {\n        const safeIn = Math.max(0, inPoint);\n        const source = timelineQueue.find(\n            (item) => item.id === mediaId\n        );\n        if (!source) return;\n        const safeOut = Math.min(\n            source.duration ?? outPoint,\n            Math.max(safeIn + 0.1, outPoint)\n        );\n\n        setTimelineQueue((current) =>\n            current.map((item) =>\n                item.id === mediaId\n                    ? {\n                          ...item,\n                          inPoint: safeIn,\n                          outPoint: safeOut\n                      }\n                    : item\n            )\n        );\n\n        if (selectedMedia?.id === mediaId) {\n            const updated = {\n                ...selectedMedia,\n                inPoint: safeIn,\n                outPoint: safeOut\n            };\n            onSelectMedia(updated);\n            const video = videoRef.current;\n            if (video) {\n                video.currentTime = safeIn;\n            }\n            setCurrentTime(safeIn);\n        }\n\n        setEditingFilm(null);\n    }\n\n    function splitFilmIntoBlocks(\n        mediaId: string,\n        inPoint: number,\n        cut1: number,\n        cut2: number,\n        outPoint: number\n    ) {\n        const sourceIndex = timelineQueue.findIndex(\n            (item) => item.id === mediaId\n        );\n        const source = timelineQueue[sourceIndex];\n        if (!source || sourceIndex < 0) return;\n\n        const points = [inPoint, cut1, cut2, outPoint];\n        if (\n            points.some((value) => !Number.isFinite(value)) ||\n            !(points[0] >= 0 &&\n              points[0] < points[1] &&\n              points[1] < points[2] &&\n              points[2] < points[3])\n        ) {\n            window.alert(\n                \"Os cortes precisam estar em ordem: IN < Corte 1 < Corte 2 < OUT.\"\n            );\n            return;\n        }\n\n        const sourceDuration = source.duration ?? outPoint;\n        if (outPoint > sourceDuration + 0.01) {\n            window.alert(\n                \"O ponto OUT não pode ultrapassar a duração do arquivo.\"\n            );\n            return;\n        }\n\n        const sourceMediaId =\n            source.sourceMediaId ?? source.id;\n        const stamp = Date.now();\n        const blocks = [0, 1, 2].map((index) => ({\n            ...source,\n            id: `${sourceMediaId}-block-${stamp}-${index + 1}`,\n            sourceMediaId,\n            inPoint: points[index],\n            outPoint: points[index + 1],\n            blockLabel: `Bloco ${index + 1}`,\n            loop: false\n        }));\n\n        setTimelineQueue((current) => {\n            const index = current.findIndex(\n                (item) => item.id === mediaId\n            );\n            if (index < 0) return current;\n            const updated = [...current];\n            updated.splice(index, 1, ...blocks);\n            return updated;\n        });\n\n        if (selectedMedia?.id === mediaId) {\n            onSelectMedia(blocks[0]);\n            setCurrentTime(blocks[0].inPoint ?? 0);\n        }\n\n        setEditingFilm(null);\n    }\n\n'''+anchor
t = replace_once(t, anchor, methods, "film edit methods")

# Video event handlers clip aware
old = '''                                    onTimeUpdate={(event) =>\n                                        setCurrentTime(\n                                            event.currentTarget.currentTime\n                                        )\n                                    }\n                                    onLoadedMetadata={(event) =>\n                                        setDuration(\n                                            event.currentTarget.duration\n                                        )\n                                    }\n                                    onDurationChange={(event) =>\n                                        setDuration(\n                                            event.currentTarget.duration\n                                        )\n                                    }'''
new = '''                                    onTimeUpdate={(event) =>\n                                        handleProgramTimeUpdate(\n                                            event.currentTarget\n                                        )\n                                    }\n                                    onLoadedMetadata={(event) => {\n                                        const video =\n                                            event.currentTarget;\n                                        const inPoint =\n                                            getClipIn(selectedMedia);\n                                        video.currentTime = inPoint;\n                                        setCurrentTime(inPoint);\n                                        setDuration(\n                                            getClipDuration(selectedMedia)\n                                        );\n                                    }}\n                                    onDurationChange={() =>\n                                        setDuration(\n                                            getClipDuration(selectedMedia)\n                                        )\n                                    }'''
t = replace_once(t, old, new, "video clip events")

# Program display clip-relative
old = '''                            {formatDuration(currentTime)}\n                            {\" / \"}\n                            {formatDuration(duration)}'''
new = '''                            {formatDuration(selectedClipCurrent)}\n                            {\" / \"}\n                            {formatDuration(selectedClipDuration)}'''
t = replace_once(t, old, new, "program clip time display")

# Timeline content: show block label and clip duration, remove old inline GC controls
old = '''                                                <strong>{item.name}</strong>\n                                                <span>\n                                                    {isCurrent\n                                                        ? `${formatDuration(\n                                                              currentTime\n                                                          )} / ${formatDuration(\n                                                              duration\n                                                          )}`\n                                                        : formatDuration(\n                                                              item.duration\n                                                          )}\n                                                </span>\n\n                                                <label\n                                                    className=\"timeline-watermark-toggle\"\n                                                    onClick={(event) =>\n                                                        event.stopPropagation()\n                                                    }\n                                                    onDoubleClick={(event) =>\n                                                        event.stopPropagation()\n                                                    }\n                                                >\n                                                    <input\n                                                        type=\"checkbox\"\n                                                        checked={Boolean(\n                                                            item.watermark\n                                                        )}\n                                                        onChange={() =>\n                                                            toggleTimelineWatermark(\n                                                                item.id\n                                                            )\n                                                        }\n                                                    />\n                                                    <span>\n                                                        Marca d'água\n                                                    </span>\n                                                </label>\n\n                                                <div\n                                                    className=\"timeline-hashtag-editor\"\n                                                    onClick={(event) =>\n                                                        event.stopPropagation()\n                                                    }\n                                                    onDoubleClick={(event) =>\n                                                        event.stopPropagation()\n                                                    }\n                                                >\n                                                    <span>H</span>\n                                                    <input\n                                                        key={`${item.id}-${item.hashtag ?? \"\"}`}\n                                                        defaultValue={\n                                                            item.hashtag ?? \"\"\n                                                        }\n                                                        placeholder=\"#Hashtag\"\n                                                        maxLength={80}\n                                                        onBlur={(event) =>\n                                                            updateTimelineHashtag(\n                                                                item.id,\n                                                                event.currentTarget.value\n                                                            )\n                                                        }\n                                                        onKeyDown={(event) => {\n                                                            if (\n                                                                event.key === \"Enter\"\n                                                            ) {\n                                                                event.currentTarget.blur();\n                                                            }\n                                                        }}\n                                                    />\n                                                </div>'''
new = '''                                                <strong>\n                                                    {item.blockLabel\n                                                        ? `${item.name} — ${item.blockLabel}`\n                                                        : item.name}\n                                                </strong>\n                                                <span>\n                                                    {isCurrent\n                                                        ? `${formatDuration(\n                                                              selectedClipCurrent\n                                                          )} / ${formatDuration(\n                                                              selectedClipDuration\n                                                          )}`\n                                                        : formatDuration(\n                                                              getClipDuration(item)\n                                                          )}\n                                                    {item.inPoint || item.outPoint != null\n                                                        ? ` • IN ${formatDuration(\n                                                              getClipIn(item)\n                                                          )} • OUT ${formatDuration(\n                                                              getClipOut(item)\n                                                          )}`\n                                                        : \"\"}\n                                                </span>'''
t = replace_once(t, old, new, "timeline content cleanup")

# Replace actions with right-side GC + edit button + actions
old = '''                                            <div\n                                                className=\"timeline-actions\"\n                                                onClick={(event) =>\n                                                    event.stopPropagation()\n                                                }\n                                            >\n                                                {!isCurrent && (\n                                                    <button\n                                                        title=\"Colocar como próximo\"\n                                                        onClick={() =>\n                                                            moveToNext(item.id)\n                                                        }\n                                                    >⏭</button>\n                                                )}\n                                                <button\n                                                    className={\n                                                        item.loop\n                                                            ? \"timeline-loop-button active\"\n                                                            : \"timeline-loop-button\"\n                                                    }\n                                                    title=\"Loop\"\n                                                    onClick={() =>\n                                                        toggleTimelineLoop(\n                                                            item.id\n                                                        )\n                                                    }\n                                                >↻</button>\n                                                {!isCurrent && (\n                                                    <button\n                                                        className=\"timeline-remove\"\n                                                        title=\"Remover da timeline\"\n                                                        onClick={() =>\n                                                            removeTimelineItem(\n                                                                item.id\n                                                            )\n                                                        }\n                                                    >×</button>\n                                                )}\n                                            </div>'''
new = '''                                            <div\n                                                className=\"timeline-right-controls\"\n                                                onClick={(event) =>\n                                                    event.stopPropagation()\n                                                }\n                                                onDoubleClick={(event) =>\n                                                    event.stopPropagation()\n                                                }\n                                            >\n                                                <div className=\"timeline-gc-controls\">\n                                                    <label\n                                                        className=\"timeline-watermark-toggle\"\n                                                        title=\"Marca d'água\"\n                                                    >\n                                                        <input\n                                                            type=\"checkbox\"\n                                                            checked={Boolean(\n                                                                item.watermark\n                                                            )}\n                                                            onChange={() =>\n                                                                toggleTimelineWatermark(\n                                                                    item.id\n                                                                )\n                                                            }\n                                                        />\n                                                        <span>Logo</span>\n                                                    </label>\n\n                                                    <div className=\"timeline-hashtag-editor\">\n                                                        <span>#</span>\n                                                        <input\n                                                            key={`${item.id}-${item.hashtag ?? \"\"}`}\n                                                            defaultValue={\n                                                                item.hashtag ?? \"\"\n                                                            }\n                                                            placeholder=\"Hashtag\"\n                                                            maxLength={80}\n                                                            onBlur={(event) =>\n                                                                updateTimelineHashtag(\n                                                                    item.id,\n                                                                    event.currentTarget.value\n                                                                )\n                                                            }\n                                                            onKeyDown={(event) => {\n                                                                if (event.key === \"Enter\") {\n                                                                    event.currentTarget.blur();\n                                                                }\n                                                            }}\n                                                        />\n                                                    </div>\n                                                </div>\n\n                                                <div className=\"timeline-actions\">\n                                                    <button\n                                                        className=\"timeline-film-edit\"\n                                                        title=\"Editar / separar filme em blocos\"\n                                                        onClick={() =>\n                                                            setEditingFilm(item)\n                                                        }\n                                                    >✂ Blocos</button>\n                                                    {!isCurrent && (\n                                                        <button\n                                                            title=\"Colocar como próximo\"\n                                                            onClick={() =>\n                                                                moveToNext(item.id)\n                                                            }\n                                                        >⏭</button>\n                                                    )}\n                                                    <button\n                                                        className={\n                                                            item.loop\n                                                                ? \"timeline-loop-button active\"\n                                                                : \"timeline-loop-button\"\n                                                        }\n                                                        title=\"Loop\"\n                                                        onClick={() =>\n                                                            toggleTimelineLoop(\n                                                                item.id\n                                                            )\n                                                        }\n                                                    >↻</button>\n                                                    {!isCurrent && (\n                                                        <button\n                                                            className=\"timeline-remove\"\n                                                            title=\"Remover da timeline\"\n                                                            onClick={() =>\n                                                                removeTimelineItem(\n                                                                    item.id\n                                                                )\n                                                            }\n                                                        >×</button>\n                                                    )}\n                                                </div>\n                                            </div>'''
t = replace_once(t, old, new, "timeline right controls")

# Add modal before closing playout root
old = '''            <div className=\"playout-library-column\">\n                <LibraryPanel'''
new = '''            {editingFilm && (\n                <FilmBlockEditor\n                    item={editingFilm}\n                    onClose={() => setEditingFilm(null)}\n                    onSaveEdit={applyFilmEdit}\n                    onSplit={splitFilmIntoBlocks}\n                />\n            )}\n\n            <div className=\"playout-library-column\">\n                <LibraryPanel'''
t = replace_once(t, old, new, "film editor modal render")

# Add FilmBlockEditor component before LibraryPanelProps
anchor = '''interface LibraryPanelProps {'''
component = r'''interface FilmBlockEditorProps {
    item: MediaItem;
    onClose: () => void;
    onSaveEdit: (
        mediaId: string,
        inPoint: number,
        outPoint: number
    ) => void;
    onSplit: (
        mediaId: string,
        inPoint: number,
        cut1: number,
        cut2: number,
        outPoint: number
    ) => void;
}

function FilmBlockEditor({
    item,
    onClose,
    onSaveEdit,
    onSplit
}: FilmBlockEditorProps) {
    const duration = Math.max(0, item.duration ?? 0);
    const initialIn = getClipIn(item);
    const initialOut = getClipOut(item);
    const span = Math.max(0.3, initialOut - initialIn);

    const [inText, setInText] = useState(
        formatEditorTime(initialIn)
    );
    const [outText, setOutText] = useState(
        formatEditorTime(initialOut)
    );
    const [cut1Text, setCut1Text] = useState(
        formatEditorTime(initialIn + span / 3)
    );
    const [cut2Text, setCut2Text] = useState(
        formatEditorTime(initialIn + (span * 2) / 3)
    );

    const parsedIn = parseEditorTime(inText);
    const parsedOut = parseEditorTime(outText);
    const parsedCut1 = parseEditorTime(cut1Text);
    const parsedCut2 = parseEditorTime(cut2Text);

    const validEdit =
        parsedIn !== null &&
        parsedOut !== null &&
        parsedIn >= 0 &&
        parsedOut > parsedIn &&
        parsedOut <= duration + 0.01;

    const validSplit =
        validEdit &&
        parsedCut1 !== null &&
        parsedCut2 !== null &&
        parsedIn! < parsedCut1 &&
        parsedCut1 < parsedCut2 &&
        parsedCut2 < parsedOut!;

    return (
        <div
            className="film-editor-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section className="film-editor-window">
                <header className="film-editor-header">
                    <div>
                        <span>EDIÇÃO NÃO DESTRUTIVA</span>
                        <h2>Editar / separar filme em blocos</h2>
                        <strong>{item.name}</strong>
                    </div>
                    <button onClick={onClose}>×</button>
                </header>

                <div className="film-editor-summary">
                    <span>Duração original</span>
                    <strong>{formatDuration(duration)}</strong>
                    <small>
                        O arquivo original não será alterado. Os blocos apenas guardam pontos IN/OUT.
                    </small>
                </div>

                <div className="film-editor-grid">
                    <TimecodeField
                        label="INÍCIO / IN"
                        value={inText}
                        onChange={setInText}
                    />
                    <TimecodeField
                        label="CORTE 1"
                        value={cut1Text}
                        onChange={setCut1Text}
                    />
                    <TimecodeField
                        label="CORTE 2"
                        value={cut2Text}
                        onChange={setCut2Text}
                    />
                    <TimecodeField
                        label="FINAL / OUT"
                        value={outText}
                        onChange={setOutText}
                    />
                </div>

                <div className="film-editor-block-preview">
                    <div>
                        <strong>Bloco 1</strong>
                        <span>{formatRange(parsedIn, parsedCut1)}</span>
                    </div>
                    <div>
                        <strong>Bloco 2</strong>
                        <span>{formatRange(parsedCut1, parsedCut2)}</span>
                    </div>
                    <div>
                        <strong>Bloco 3</strong>
                        <span>{formatRange(parsedCut2, parsedOut)}</span>
                    </div>
                </div>

                {!validEdit && (
                    <div className="film-editor-error">
                        IN/OUT inválidos. Use mm:ss ou hh:mm:ss e não ultrapasse a duração do filme.
                    </div>
                )}

                <footer className="film-editor-footer">
                    <button onClick={onClose}>Cancelar</button>
                    <button
                        disabled={!validEdit}
                        onClick={() =>
                            validEdit &&
                            onSaveEdit(
                                item.id,
                                parsedIn!,
                                parsedOut!
                            )
                        }
                    >
                        Salvar somente edição
                    </button>
                    <button
                        className="primary-button"
                        disabled={!validSplit}
                        onClick={() =>
                            validSplit &&
                            onSplit(
                                item.id,
                                parsedIn!,
                                parsedCut1!,
                                parsedCut2!,
                                parsedOut!
                            )
                        }
                    >
                        Separar em 3 blocos
                    </button>
                </footer>
            </section>
        </div>
    );
}

function TimecodeField({
    label,
    value,
    onChange
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="film-timecode-field">
            <span>{label}</span>
            <input
                value={value}
                inputMode="numeric"
                placeholder="00:00"
                onChange={(event) =>
                    onChange(event.currentTarget.value)
                }
            />
        </label>
    );
}

'''+anchor
t = replace_once(t, anchor, component, "film editor component")

# Add helper functions before normalizeHashtag if available
anchor = '''function normalizeHashtag(value: string) {'''
helpers = r'''function normalizeClipPoint(
    value: unknown,
    fallback = 0
) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.max(0, parsed)
        : fallback;
}

function normalizeClipOutPoint(
    value: unknown,
    sourceDuration: number | null | undefined
) {
    const duration = Math.max(
        0,
        Number(sourceDuration) || 0
    );
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return duration;
    }
    return duration > 0
        ? Math.min(duration, parsed)
        : parsed;
}

function getClipIn(item: MediaItem | null) {
    return normalizeClipPoint(item?.inPoint, 0);
}

function getClipOut(item: MediaItem | null) {
    const sourceDuration = Math.max(
        0,
        Number(item?.duration) || 0
    );
    return normalizeClipOutPoint(
        item?.outPoint,
        sourceDuration
    );
}

function getClipDuration(item: MediaItem | null) {
    return Math.max(
        0,
        getClipOut(item) - getClipIn(item)
    );
}

function parseEditorTime(value: string) {
    const clean = value.trim();
    if (!clean) return null;

    if (/^\d+(?:[.,]\d+)?$/.test(clean)) {
        const numeric = Number(clean.replace(",", "."));
        return Number.isFinite(numeric) ? numeric : null;
    }

    const parts = clean.split(":");
    if (parts.length < 2 || parts.length > 3) {
        return null;
    }

    const numbers = parts.map((part) =>
        Number(part.replace(",", "."))
    );
    if (numbers.some((part) => !Number.isFinite(part))) {
        return null;
    }

    if (parts.length === 2) {
        return numbers[0] * 60 + numbers[1];
    }

    return (
        numbers[0] * 3600 +
        numbers[1] * 60 +
        numbers[2]
    );
}

function formatEditorTime(seconds: number) {
    const safe = Math.max(0, seconds || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);

    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatRange(
    start: number | null,
    end: number | null
) {
    if (start === null || end === null || end <= start) {
        return "--:--";
    }
    return `${formatEditorTime(start)} → ${formatEditorTime(end)} • ${formatDuration(end - start)}`;
}

'''+anchor
t = replace_once(t, anchor, helpers, "clip helper functions")

p.write_text(t, encoding="utf-8")

# --- database.js ---
p = Path("src/database/database.js")
t = p.read_text(encoding="utf-8")
old = '''                watermark: Boolean(entry.watermark),\n                hashtag:\n                    normalizeHashtag(\n                        entry.hashtag ?? \"\"\n                    )'''
new = '''                watermark: Boolean(entry.watermark),\n                inPoint: normalizeClipNumber(entry.inPoint, 0),\n                outPoint: normalizeClipNumber(\n                    entry.outPoint,\n                    sourceMedia.duration ?? 0\n                ),\n                blockLabel: normalizeText(\n                    entry.blockLabel,\n                    \"\",\n                    80\n                ),\n                hashtag:\n                    normalizeHashtag(\n                        entry.hashtag ?? \"\"\n                    )'''
t = replace_once(t, old, new, "getTimeline clip fields")
old = '''                loop: Boolean(item.loop),\n                watermark: Boolean(item.watermark),\n                hashtag:\n                    normalizeHashtag('''
new = '''                loop: Boolean(item.loop),\n                watermark: Boolean(item.watermark),\n                inPoint: normalizeClipNumber(item.inPoint, 0),\n                outPoint: normalizeClipNumber(\n                    item.outPoint,\n                    item.duration ?? 0\n                ),\n                blockLabel: normalizeText(\n                    item.blockLabel,\n                    \"\",\n                    80\n                ),\n                hashtag:\n                    normalizeHashtag('''
t = replace_once(t, old, new, "saveTimeline clip fields")

# normalize helper before saveTimeline or normalizeHashtag
anchor = '''function saveTimeline(timelineItems) {'''
helper = '''function normalizeClipNumber(value, fallback = 0) {\n    const parsed = Number(value);\n    return Number.isFinite(parsed)\n        ? Math.max(0, parsed)\n        : Math.max(0, Number(fallback) || 0);\n}\n\n'''+anchor
t = replace_once(t, anchor, helper, "database clip helper")
p.write_text(t, encoding="utf-8")

# --- main.js ---
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")
# compute clip remaining using OUT
old = '''    const programState = {\n        ...(overlayState && typeof overlayState === \"object\"\n            ? overlayState\n            : {}),\n        startSeconds:\n            normalizedStartSeconds\n    };'''
new = '''    const programState = {\n        ...(overlayState && typeof overlayState === \"object\"\n            ? overlayState\n            : {}),\n        startSeconds:\n            normalizedStartSeconds\n    };\n    const normalizedOutPoint =\n        Number.isFinite(Number(programState.outPointSeconds))\n            ? Math.max(\n                  normalizedStartSeconds,\n                  Number(programState.outPointSeconds)\n              )\n            : null;\n    const clipRemainingSeconds =\n        normalizedOutPoint !== null\n            ? Math.max(\n                  0.001,\n                  normalizedOutPoint - normalizedStartSeconds\n              )\n            : null;'''
t = replace_once(t, old, new, "main clip remaining")

# Add -t after media input, before watermark input
old = '''    args.push(\n        \"-i\",\n        filePath\n    );\n\n    if (watermarkEnabled) {'''
new = '''    args.push(\n        \"-i\",\n        filePath\n    );\n\n    if (clipRemainingSeconds !== null) {\n        args.push(\n            \"-t\",\n            clipRemainingSeconds.toFixed(3)\n        );\n    }\n\n    if (watermarkEnabled) {'''
t = replace_once(t, old, new, "main ffmpeg clip t")

# diagnostic
old = '''            ` | timing=${programState.timingMode ?? \"unknown\"}`\n    );'''
new = '''            ` | timing=${programState.timingMode ?? \"unknown\"}` +\n            ` | OUT=${normalizedOutPoint ?? \"EOF\"}`\n    );'''
t = replace_once(t, old, new, "clip diagnostic")
p.write_text(t, encoding="utf-8")

# --- styles.css ---
p = Path("src/renderer/src/styles.css")
t = p.read_text(encoding="utf-8")
t += r'''

/* ===== FILM BLOCK EDITOR / TIMELINE GC RIGHT SIDE ===== */
.timeline-right-controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
}

.timeline-gc-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

.timeline-gc-controls .timeline-watermark-toggle {
    min-width: 72px;
    margin: 0;
    padding: 5px 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid #454545;
    border-radius: 5px;
    background: #202020;
    cursor: pointer;
}

.timeline-gc-controls .timeline-watermark-toggle span {
    font-size: 11px;
    color: #c8c8c8;
}

.timeline-gc-controls .timeline-hashtag-editor {
    width: 155px;
    margin: 0;
}

.timeline-gc-controls .timeline-hashtag-editor input {
    width: 120px;
}

.timeline-actions {
    display: flex;
    align-items: center;
    gap: 5px;
}

.timeline-film-edit {
    min-width: 76px;
    height: 30px;
    padding: 0 8px;
    color: #d7d7d7;
    background: #242424;
    border: 1px solid #4b4b4b;
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
}

.timeline-film-edit:hover {
    color: #fff;
    border-color: #8b5360;
    background: #392129;
}

.film-editor-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(4px);
}

.film-editor-window {
    width: min(880px, 96vw);
    max-height: 92vh;
    overflow-y: auto;
    padding: 22px;
    color: #efefef;
    background: #151515;
    border: 1px solid #444;
    border-radius: 10px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.65);
}

.film-editor-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid #333;
}

.film-editor-header span {
    color: #c74960;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
}

.film-editor-header h2 {
    margin: 5px 0 5px;
    font-size: 22px;
}

.film-editor-header strong {
    color: #aaa;
    font-size: 13px;
}

.film-editor-header > button {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid #444;
    border-radius: 6px;
    color: #ccc;
    background: #222;
    font-size: 20px;
    cursor: pointer;
}

.film-editor-summary {
    margin: 18px 0;
    padding: 14px;
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 10px 16px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 7px;
}

.film-editor-summary span,
.film-editor-summary small {
    color: #888;
    font-size: 12px;
}

.film-editor-summary strong {
    font-variant-numeric: tabular-nums;
}

.film-editor-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(120px, 1fr));
    gap: 12px;
}

.film-timecode-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.film-timecode-field span {
    color: #969696;
    font-size: 10px;
    font-weight: 700;
}

.film-timecode-field input {
    width: 100%;
    height: 42px;
    padding: 0 11px;
    color: #fff;
    background: #0f0f0f;
    border: 1px solid #444;
    border-radius: 6px;
    outline: none;
    font-family: Consolas, monospace;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
}

.film-timecode-field input:focus {
    border-color: #a52c43;
}

.film-editor-block-preview {
    margin-top: 18px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}

.film-editor-block-preview div {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: #21191b;
    border: 1px solid #53303a;
    border-radius: 6px;
}

.film-editor-block-preview strong {
    color: #f1c3cb;
    font-size: 12px;
}

.film-editor-block-preview span {
    color: #9c8a8d;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

.film-editor-error {
    margin-top: 14px;
    padding: 10px 12px;
    color: #ff9aaa;
    background: #31171d;
    border: 1px solid #6a2b38;
    border-radius: 6px;
    font-size: 12px;
}

.film-editor-footer {
    margin-top: 20px;
    padding-top: 16px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid #333;
}

.film-editor-footer button {
    min-height: 36px;
    padding: 0 13px;
    color: #ddd;
    background: #242424;
    border: 1px solid #484848;
    border-radius: 6px;
    cursor: pointer;
}

.film-editor-footer button.primary-button {
    color: #fff;
    background: #9e1f36;
    border-color: #bc3048;
}

.film-editor-footer button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

@media (max-width: 1300px) {
    .timeline-right-controls {
        flex-direction: column;
        align-items: flex-end;
        gap: 5px;
    }

    .film-editor-grid {
        grid-template-columns: 1fr 1fr;
    }
}
'''
p.write_text(t, encoding="utf-8")

print("film block editor migration applied")
