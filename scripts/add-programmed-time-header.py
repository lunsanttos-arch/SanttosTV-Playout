from pathlib import Path

p=Path('src/renderer/src/App.tsx')
t=p.read_text(encoding='utf-8')

def r(old,new,label):
    global t
    if old not in t:
        raise SystemExit(f'anchor missing: {label}')
    t=t.replace(old,new,1)

# App state for schedule summary
r('''    const [hashtagStyle, setHashtagStyle] =\n        useState<HashtagStyle>(\n            DEFAULT_HASHTAG_STYLE\n        );''','''    const [hashtagStyle, setHashtagStyle] =\n        useState<HashtagStyle>(\n            DEFAULT_HASHTAG_STYLE\n        );\n    const [programmedRemainingSeconds, setProgrammedRemainingSeconds] =\n        useState(0);\n    const [programmedIndefinite, setProgrammedIndefinite] =\n        useState(false);''','app schedule state')

# derive labels before return
r('''    return (\n        <div className=\"app-shell\">''','''    const programmedDurationLabel =\n        programmedIndefinite\n            ? \"LOOP\"\n            : formatProgrammedDuration(\n                  programmedRemainingSeconds\n              );\n    const programmedUntilLabel =\n        programmedIndefinite\n            ? \"SEM PREVISÃO\"\n            : programmedRemainingSeconds > 0\n              ? new Date(\n                    Date.now() +\n                        programmedRemainingSeconds * 1000\n                ).toLocaleTimeString(\n                    \"pt-BR\",\n                    {\n                        hour: \"2-digit\",\n                        minute: \"2-digit\",\n                        second: \"2-digit\"\n                    }\n                )\n              : \"--:--:--\";\n\n    return (\n        <div className=\"app-shell\">''','schedule labels')

# replace clock with clock + schedule info
r('''                <div className=\"master-clock\">\n                    {clock}\n                </div>''','''                <div className=\"header-time-center\">\n                    <div className=\"master-clock\">\n                        {clock}\n                    </div>\n                    <div className=\"programmed-time-summary\">\n                        <div>\n                            <span>PROGRAMADO</span>\n                            <strong>{programmedDurationLabel}</strong>\n                        </div>\n                        <div>\n                            <span>ATÉ</span>\n                            <strong>{programmedUntilLabel}</strong>\n                        </div>\n                    </div>\n                </div>''','topbar schedule summary')

# pass callback to PlayoutPanel
r('''                            onImportDroppedFiles={importDroppedFiles}\n                            onRemoveMedia={handleRemoveMedia}''','''                            onImportDroppedFiles={importDroppedFiles}\n                            onRemoveMedia={handleRemoveMedia}\n                            onScheduleSummary={(remainingSeconds, indefinite) => {\n                                setProgrammedRemainingSeconds(remainingSeconds);\n                                setProgrammedIndefinite(indefinite);\n                            }}''','pass summary callback')

# Playout prop interface
r('''    onRemoveMedia: (\n        media: MediaItem\n    ) => Promise<void>;\n}''','''    onRemoveMedia: (\n        media: MediaItem\n    ) => Promise<void>;\n    onScheduleSummary: (\n        remainingSeconds: number,\n        indefinite: boolean\n    ) => void;\n}''','playout summary prop type')

# destructure callback
r('''    onImportDroppedFiles,\n    onRemoveMedia\n}: PlayoutPanelProps) {''','''    onImportDroppedFiles,\n    onRemoveMedia,\n    onScheduleSummary\n}: PlayoutPanelProps) {''','playout summary destructure')

# add effect after selected clip timing calculations anchor
anchor='''    const selectedClipCurrent = Math.max(\n        0,\n        currentTime - selectedClipIn\n    );'''
insert=anchor+'''\n\n    useEffect(() => {\n        if (timelineQueue.length === 0) {\n            onScheduleSummary(0, false);\n            return;\n        }\n\n        const startIndex =\n            selectedMediaIndex >= 0\n                ? selectedMediaIndex\n                : 0;\n        const remainingItems =\n            timelineQueue.slice(startIndex);\n        const indefinite =\n            remainingItems.some((item) => Boolean(item.loop));\n\n        if (indefinite) {\n            onScheduleSummary(0, true);\n            return;\n        }\n\n        let remaining = 0;\n        remainingItems.forEach((item, index) => {\n            if (\n                index === 0 &&\n                selectedMediaIndex >= 0\n            ) {\n                remaining += Math.max(\n                    0,\n                    getClipDuration(item) -\n                        selectedClipCurrent\n                );\n                return;\n            }\n\n            remaining += getClipDuration(item);\n        });\n\n        onScheduleSummary(remaining, false);\n    }, [\n        timelineQueue,\n        selectedMediaIndex,\n        selectedClipCurrent,\n        onScheduleSummary\n    ]);'''
r(anchor,insert,'schedule summary effect')

# helper before normalizeClipPoint (or before first helper near bottom)
anchor='''function normalizeClipPoint('''
helper='''function formatProgrammedDuration(seconds: number) {\n    const safe = Math.max(0, Math.floor(Number(seconds) || 0));\n    const hours = Math.floor(safe / 3600);\n    const minutes = Math.floor((safe % 3600) / 60);\n    const secs = safe % 60;\n\n    return [hours, minutes, secs]\n        .map((value) => String(value).padStart(2, \"0\"))\n        .join(\":\");\n}\n\n'''+anchor
r(anchor,helper,'programmed duration helper')

p.write_text(t,encoding='utf-8')

# CSS
p=Path('src/renderer/src/styles.css')
s=p.read_text(encoding='utf-8')
s += '''\n\n/* ===== TEMPO PROGRAMADO NO CABEÇALHO ===== */\n.header-time-center {\n    display: flex;\n    align-items: center;\n    gap: 22px;\n    min-width: 0;\n}\n\n.programmed-time-summary {\n    display: flex;\n    align-items: stretch;\n    gap: 8px;\n}\n\n.programmed-time-summary > div {\n    min-width: 108px;\n    padding: 6px 10px;\n    display: flex;\n    flex-direction: column;\n    justify-content: center;\n    gap: 2px;\n    background: #101010;\n    border: 1px solid #343434;\n    border-radius: 6px;\n}\n\n.programmed-time-summary span {\n    color: #777777;\n    font-size: 9px;\n    font-weight: 700;\n    letter-spacing: 0.9px;\n}\n\n.programmed-time-summary strong {\n    color: #e5e5e5;\n    font-size: 13px;\n    font-variant-numeric: tabular-nums;\n    white-space: nowrap;\n}\n\n@media (max-width: 1250px) {\n    .programmed-time-summary {\n        display: none;\n    }\n}\n'''
p.write_text(s,encoding='utf-8')
print('programmed time header applied')
