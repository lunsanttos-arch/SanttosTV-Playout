from pathlib import Path

p = Path('src/renderer/src/App.tsx')
t = p.read_text(encoding='utf-8')

old = '''                    {activePanel === "playout" && (\n                        <PlayoutPanel\n                            media={media}\n                            isLoading={isLoading}\n                            message={message}\n                            selectedMedia={selectedMedia}\n                            hashtagStyle={hashtagStyle}\n                            onSelectMedia={setSelectedMedia}\n                            onAddVideos={addVideos}\n                            onImportDroppedFiles={importDroppedFiles}\n                            onRemoveMedia={handleRemoveMedia}\n                            onScheduleSummary={(remainingSeconds, indefinite) => {\n                                setProgrammedRemainingSeconds(remainingSeconds);\n                                setProgrammedIndefinite(indefinite);\n                            }}\n                        />\n                    )}\n'''

new = '''                    <div\n                        className={\n                            activePanel === "playout"\n                                ? "persistent-playout-view active"\n                                : "persistent-playout-view hidden"\n                        }\n                        aria-hidden={activePanel !== "playout"}\n                    >\n                        <PlayoutPanel\n                            media={media}\n                            isLoading={isLoading}\n                            message={message}\n                            selectedMedia={selectedMedia}\n                            hashtagStyle={hashtagStyle}\n                            onSelectMedia={setSelectedMedia}\n                            onAddVideos={addVideos}\n                            onImportDroppedFiles={importDroppedFiles}\n                            onRemoveMedia={handleRemoveMedia}\n                            onScheduleSummary={(remainingSeconds, indefinite) => {\n                                setProgrammedRemainingSeconds(remainingSeconds);\n                                setProgrammedIndefinite(indefinite);\n                            }}\n                        />\n                    </div>\n'''

if old not in t:
    raise SystemExit('Playout conditional mount anchor not found')

t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

p = Path('src/renderer/src/styles.css')
s = p.read_text(encoding='utf-8')
append = '''\n\n/* Playout permanece montado durante a navegação para não interromper o PROGRAM. */\n.main-content {\n    position: relative;\n}\n\n.persistent-playout-view {\n    width: 100%;\n    height: 100%;\n}\n\n.persistent-playout-view.hidden {\n    position: absolute;\n    inset: 15px;\n    width: auto;\n    height: auto;\n    visibility: hidden;\n    pointer-events: none;\n    z-index: -1;\n}\n'''

if 'persistent-playout-view.hidden' not in s:
    s += append
p.write_text(s, encoding='utf-8')

print('Persistent playout navigation fix applied')
