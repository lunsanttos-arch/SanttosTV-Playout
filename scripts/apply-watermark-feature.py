from pathlib import Path


def must_replace(text, old, new, name):
    if old not in text:
        raise RuntimeError(f"missing anchor: {name}")
    return text.replace(old, new, 1)


# DATABASE
p = Path("src/database/database.js")
t = p.read_text(encoding="utf-8")

if "const DEFAULT_WATERMARK_STYLE" not in t:
    t = must_replace(
        t,
        "const DEFAULT_OUTPUT_SETTINGS = {",
        '''const DEFAULT_WATERMARK_STYLE = {
    filePath: "",
    widthPx: 180,
    x: 1680,
    y: 40,
    opacity: 0.82,
    fadeMs: 200
};

const DEFAULT_OUTPUT_SETTINGS = {''',
        "db default"
    )

if "watermarkStyle: {" not in t:
    t = must_replace(
        t,
        "        output: structuredClone(DEFAULT_OUTPUT_SETTINGS),\n        hashtagStyle:",
        "        output: structuredClone(DEFAULT_OUTPUT_SETTINGS),\n        watermarkStyle: {\n            ...DEFAULT_WATERMARK_STYLE\n        },\n        hashtagStyle:",
        "db initial"
    )

if "function normalizeWatermarkStyle" not in t:
    t = must_replace(
        t,
        "function normalizeOutputSettings(value = {}) {",
        '''function normalizeWatermarkStyle(value = {}) {
    return {
        filePath: normalizeText(value.filePath, "", 4096),
        widthPx: normalizeInteger(value.widthPx, 180, 24, 960),
        x: normalizeInteger(value.x, 1680, 0, 1920),
        y: normalizeInteger(value.y, 40, 0, 1080),
        opacity: normalizeNumber(value.opacity, 0.82, 0, 1),
        fadeMs: normalizeInteger(value.fadeMs, 200, 0, 2000)
    };
}

function normalizeOutputSettings(value = {}) {''',
        "db normalizer"
    )

if "watermarkStyle:\n                    normalizeWatermarkStyle" not in t:
    t = must_replace(
        t,
        "                hashtagStyle:\n                    normalizeHashtagStyle(",
        "                watermarkStyle:\n                    normalizeWatermarkStyle(\n                        parsedSettings.watermarkStyle\n                    ),\n                hashtagStyle:\n                    normalizeHashtagStyle(",
        "db load"
    )

if "function updateWatermarkStyle" not in t:
    t = must_replace(
        t,
        "function updateHashtagStyle(style) {",
        '''function updateWatermarkStyle(style) {
    data.settings.watermarkStyle =
        normalizeWatermarkStyle(style);

    saveDatabase();

    return structuredClone(
        data.settings.watermarkStyle
    );
}

function updateHashtagStyle(style) {''',
        "db updater"
    )

# Timeline hydration and persistence.
t = t.replace(
    "                loop: Boolean(entry.loop),\n                hashtag:",
    "                loop: Boolean(entry.loop),\n                watermark: Boolean(entry.watermark),\n                hashtag:"
)

if "                watermark: Boolean(item.watermark)," not in t:
    t = must_replace(
        t,
        "                loop: Boolean(item.loop),\n                hashtag:",
        "                loop: Boolean(item.loop),\n                watermark: Boolean(item.watermark),\n                hashtag:",
        "db timeline save"
    )

if "    updateWatermarkStyle," not in t:
    t = must_replace(
        t,
        "    updateOutputSettings,\n    updateHashtagStyle,",
        "    updateOutputSettings,\n    updateWatermarkStyle,\n    updateHashtagStyle,",
        "db export"
    )

p.write_text(t, encoding="utf-8")


# PRELOAD
p = Path("src/main/preload.js")
t = p.read_text(encoding="utf-8")

if "selectWatermark:" not in t:
    t = must_replace(
        t,
        '''        saveHashtagStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-hashtag-style",
                style
            ),''',
        '''        saveHashtagStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-hashtag-style",
                style
            ),

        selectWatermark: () =>
            ipcRenderer.invoke(
                "watermark:select"
            ),

        saveWatermarkStyle: (style) =>
            ipcRenderer.invoke(
                "settings:set-watermark-style",
                style
            ),''',
        "preload wm api"
    )

if "overlayState = {}" not in t:
    t = must_replace(
        t,
        '''            hashtag = ""
        ) =>
            ipcRenderer.invoke(
                "ndi:play-file",
                filePath,
                startSeconds,
                hashtag
            ),''',
        '''            hashtag = "",
            overlayState = {}
        ) =>
            ipcRenderer.invoke(
                "ndi:play-file",
                filePath,
                startSeconds,
                hashtag,
                overlayState
            ),''',
        "preload state"
    )

p.write_text(t, encoding="utf-8")


# MAIN
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")

if "    updateWatermarkStyle," not in t:
    t = must_replace(
        t,
        "    updateOutputSettings,\n    updateHashtagStyle,",
        "    updateOutputSettings,\n    updateWatermarkStyle,\n    updateHashtagStyle,",
        "main import"
    )

start = t.find("function buildVideoFilter(hashtag) {")
if start != -1:
    end = t.find("\nfunction stopNativePlayback()", start)
    if end == -1:
        raise RuntimeError("missing buildVideoFilter end")

    replacement = r'''function buildFadeAlphaExpression(
    fadeIn,
    fadeOut,
    remainingSeconds,
    fadeSeconds
) {
    const d = Math.max(
        0,
        Number(fadeSeconds) || 0
    );
    const remaining = Math.max(
        0,
        Number(remainingSeconds) || 0
    );

    if (d <= 0) {
        return "1";
    }

    const parts = [];

    if (fadeIn) {
        parts.push(
            `if(lt(t\\,${d.toFixed(3)})\\,t/${d.toFixed(3)}\\,1)`
        );
    }

    if (fadeOut && remaining > d) {
        const fadeStart = Math.max(
            0,
            remaining - d
        );
        parts.push(
            `if(gt(t\\,${fadeStart.toFixed(3)})\\,max(0\\,(${remaining.toFixed(3)}-t)/${d.toFixed(3)})\\,1)`
        );
    }

    if (parts.length === 0) {
        return "1";
    }

    if (parts.length === 1) {
        return parts[0];
    }

    return `min(${parts[0]}\\,${parts[1]})`;
}

function buildProgramFilterGraph(
    hashtag,
    overlayState,
    hasWatermarkInput
) {
    const state =
        overlayState &&
        typeof overlayState === "object"
            ? overlayState
            : {};

    const remaining = Math.max(
        0,
        (Number(state.durationSeconds) || 0) -
            (Number(state.startSeconds) || 0)
    );

    const chains = [
        "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]"
    ];

    let current = "base";

    if (hasWatermarkInput) {
        const wm = getSettings().watermarkStyle;
        const fade = Math.max(
            0,
            Number(wm.fadeMs) / 1000
        );
        const filters = [
            `scale=${Math.round(wm.widthPx)}:-1`,
            "format=rgba",
            `colorchannelmixer=aa=${Math.max(
                0,
                Math.min(
                    1,
                    Number(wm.opacity) || 0
                )
            ).toFixed(3)}`
        ];

        if (
            state.watermarkFadeIn &&
            fade > 0
        ) {
            filters.push(
                `fade=t=in:st=0:d=${fade.toFixed(3)}:alpha=1`
            );
        }

        if (
            state.watermarkFadeOut &&
            remaining > fade &&
            fade > 0
        ) {
            filters.push(
                `fade=t=out:st=${Math.max(
                    0,
                    remaining - fade
                ).toFixed(3)}:d=${fade.toFixed(3)}:alpha=1`
            );
        }

        chains.push(
            `[1:v]${filters.join(",")}[wm]`
        );
        chains.push(
            `[${current}][wm]overlay=x=${Math.round(
                wm.x
            )}:y=${Math.round(
                wm.y
            )}:shortest=1[watermarked]`
        );
        current = "watermarked";
    }

    const text =
        typeof hashtag === "string"
            ? hashtag.trim()
            : "";

    if (text) {
        const style =
            getSettings().hashtagStyle;
        const alpha =
            buildFadeAlphaExpression(
                Boolean(state.hashtagFadeIn),
                Boolean(state.hashtagFadeOut),
                remaining,
                0.2
            );
        const options = [
            `fontfile='${resolveHashtagFont(style)}'`,
            `text='${escapeDrawtextText(text)}'`,
            `x=${Math.round(style.x)}`,
            `y=${Math.round(style.y)}`,
            `fontsize=${Math.round(style.fontSize)}`,
            `fontcolor=${toFfmpegColor(style.color, style.opacity)}`,
            `borderw=${Math.round(style.outlineWidth)}`,
            `bordercolor=${toFfmpegColor(style.outlineColor, style.outlineOpacity)}`,
            `alpha='${alpha}'`
        ];

        if (style.shadowEnabled) {
            options.push(
                `shadowcolor=${toFfmpegColor(style.shadowColor, style.shadowOpacity)}`,
                `shadowx=${Math.round(style.shadowX)}`,
                `shadowy=${Math.round(style.shadowY)}`
            );
        }

        chains.push(
            `[${current}]drawtext=${options.join(":")}[program]`
        );
        current = "program";
    }

    if (current != "program") {
        chains.push(
            `[${current}]null[program]`
        );
    }

    return chains.join(";");
}
'''

    t = t[:start] + replacement + t[end:]

if "overlayState = {}\n) {" not in t:
    t = must_replace(
        t,
        '''function startNativePlayback(
    filePath,
    startSeconds = 0,
    hashtag = ""
) {''',
        '''function startNativePlayback(
    filePath,
    startSeconds = 0,
    hashtag = "",
    overlayState = {}
) {''',
        "main signature"
    )

if "const watermarkStyle =" not in t:
    t = must_replace(
        t,
        '''    const ffmpegPath = resolveFfmpegPath();
    const videoFilter =
        buildVideoFilter(hashtag);

    const args = [''',
        '''    const ffmpegPath = resolveFfmpegPath();
    const watermarkStyle =
        getSettings().watermarkStyle;
    const watermarkEnabled = Boolean(
        overlayState?.watermarkEnabled &&
        watermarkStyle?.filePath &&
        fs.existsSync(
            watermarkStyle.filePath
        )
    );
    const programState = {
        ...(overlayState && typeof overlayState === "object"
            ? overlayState
            : {}),
        startSeconds:
            normalizedStartSeconds
    };

    const args = [''',
        "main wm setup"
    )

native_start = t.find("function startNativePlayback(")
if "buildProgramFilterGraph(" not in t[native_start:]:
    old = '''    args.push(
        "-i",
        filePath,
        "-map",
        "0:v:0",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        videoFilter,
        "-pix_fmt",
        "bgra",
        "-f",
        "rawvideo",
        "pipe:1"
    );'''
    new = '''    args.push(
        "-i",
        filePath
    );

    if (watermarkEnabled) {
        args.push(
            "-loop",
            "1",
            "-framerate",
            "30000/1001",
            "-i",
            watermarkStyle.filePath
        );
    }

    args.push(
        "-filter_complex",
        buildProgramFilterGraph(
            hashtag,
            programState,
            watermarkEnabled
        ),
        "-map",
        "[program]",
        "-an",
        "-sn",
        "-dn",
        "-pix_fmt",
        "bgra",
        "-f",
        "rawvideo",
        "pipe:1"
    );'''
    t = must_replace(
        t,
        old,
        new,
        "main ffmpeg args"
    )

if "overlayState = {}\n        ) =>" not in t:
    t = must_replace(
        t,
        '''            startSeconds = 0,
            hashtag = ""
        ) => {
            try {
                return startNativePlayback(
                    filePath,
                    startSeconds,
                    hashtag
                );''',
        '''            startSeconds = 0,
            hashtag = "",
            overlayState = {}
        ) => {
            try {
                return startNativePlayback(
                    filePath,
                    startSeconds,
                    hashtag,
                    overlayState
                );''',
        "main ipc state"
    )

if '"watermark:select"' not in t:
    anchor = '''    ipcMain.handle(
        "settings:set-hashtag-style",
        async (_event, style) => ({
            ok: true,
            hashtagStyle:
                updateHashtagStyle(style)
        })
    );'''
    addition = anchor + '''

    ipcMain.handle(
        "watermark:select",
        async () => {
            const result =
                await dialog.showOpenDialog({
                    title:
                        "Selecionar marca d'água",
                    properties: [
                        "openFile"
                    ],
                    filters: [
                        {
                            name: "Imagens",
                            extensions: [
                                "png",
                                "webp",
                                "jpg",
                                "jpeg"
                            ]
                        }
                    ]
                });

            if (
                result.canceled ||
                result.filePaths.length === 0
            ) {
                return {
                    ok: false,
                    canceled: true
                };
            }

            const current =
                getSettings().watermarkStyle;

            return {
                ok: true,
                watermarkStyle:
                    updateWatermarkStyle({
                        ...current,
                        filePath:
                            result.filePaths[0]
                    })
            };
        }
    );

    ipcMain.handle(
        "settings:set-watermark-style",
        async (_event, style) => ({
            ok: true,
            watermarkStyle:
                updateWatermarkStyle(style)
        })
    );'''

    t = must_replace(
        t,
        anchor,
        addition,
        "main wm ipc"
    )

p.write_text(t, encoding="utf-8")


# APP
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

if "watermark?: boolean;" not in t:
    t = must_replace(
        t,
        "    loop?: boolean;\n    hashtag?: string;",
        "    loop?: boolean;\n    watermark?: boolean;\n    hashtag?: string;",
        "app type"
    )

if "watermark: Boolean(entry.watermark)," not in t:
    t = must_replace(
        t,
        "                        loop: Boolean(entry.loop),\n                        hashtag:",
        "                        loop: Boolean(entry.loop),\n                        watermark: Boolean(entry.watermark),\n                        hashtag:",
        "app merge"
    )

if "            watermark: false," not in t:
    t = must_replace(
        t,
        "            loop: false,\n            hashtag: \"\"",
        "            loop: false,\n            watermark: false,\n            hashtag: \"\"",
        "app new item"
    )

if "function buildOverlayState(" not in t:
    old = '''    async function startNativeNdi(
        mediaItem: MediaItem,
        startSeconds = 0
    ) {
        const result =
            await window.santtosAPI
                .playNdiFile(
                    mediaItem.path,
                    startSeconds,
                    mediaItem.hashtag ?? ""
                );'''
    new = '''    function buildOverlayState(
        mediaItem: MediaItem,
        startSeconds = 0,
        continuousSelf = false
    ) {
        const itemIndex =
            timelineQueue.findIndex(
                (item) =>
                    item.id === mediaItem.id
            );
        const previous = continuousSelf
            ? mediaItem
            : itemIndex > 0
              ? timelineQueue[itemIndex - 1]
              : null;
        const following = mediaItem.loop
            ? mediaItem
            : itemIndex >= 0
              ? timelineQueue[
                    itemIndex + 1
                ] ?? null
              : null;
        const resuming =
            startSeconds > 0;

        return {
            durationSeconds:
                mediaItem.duration ?? 0,
            watermarkEnabled:
                Boolean(mediaItem.watermark),
            watermarkFadeIn:
                Boolean(mediaItem.watermark) &&
                !resuming &&
                !Boolean(previous?.watermark),
            watermarkFadeOut:
                Boolean(mediaItem.watermark) &&
                !Boolean(following?.watermark),
            hashtagFadeIn:
                Boolean(mediaItem.hashtag) &&
                !resuming &&
                !Boolean(previous?.hashtag),
            hashtagFadeOut:
                Boolean(mediaItem.hashtag) &&
                !Boolean(following?.hashtag)
        };
    }

    async function startNativeNdi(
        mediaItem: MediaItem,
        startSeconds = 0,
        continuousSelf = false
    ) {
        const result =
            await window.santtosAPI
                .playNdiFile(
                    mediaItem.path,
                    startSeconds,
                    mediaItem.hashtag ?? "",
                    buildOverlayState(
                        mediaItem,
                        startSeconds,
                        continuousSelf
                    )
                );'''

    t = must_replace(
        t,
        old,
        new,
        "app state builder"
    )

loop_start = t.find("if (selectedMedia?.loop)")
loop_end = t.find("if (!nextMedia)", loop_start)
if loop_start != -1 and loop_end != -1:
    loop_text = t[loop_start:loop_end]
    if "true\n            );" not in loop_text:
        t = must_replace(
            t,
            "            await startNativeNdi(selectedMedia, 0);",
            "            await startNativeNdi(\n                selectedMedia,\n                0,\n                true\n            );",
            "app loop"
        )

if "function toggleTimelineWatermark" not in t:
    anchor = '''    async function updateTimelineHashtag(
        mediaId: string,
        value: string
    ) {'''
    func = '''    function toggleTimelineWatermark(
        mediaId: string
    ) {
        setTimelineQueue((current) =>
            current.map((item) =>
                item.id === mediaId
                    ? {
                          ...item,
                          watermark:
                              !item.watermark
                      }
                    : item
            )
        );

        if (
            selectedMedia?.id === mediaId
        ) {
            const updatedSelected = {
                ...selectedMedia,
                watermark:
                    !selectedMedia.watermark
            };

            onSelectMedia(updatedSelected);

            if (isPlaying) {
                startNativeNdi(
                    updatedSelected,
                    videoRef.current
                        ?.currentTime ??
                        currentTime,
                    true
                ).catch((error) =>
                    console.error(
                        "Erro ao atualizar marca d'água no NDI:",
                        error
                    )
                );
            }
        }
    }

'''

    t = must_replace(
        t,
        anchor,
        func + anchor,
        "app toggle"
    )

if 'className="timeline-watermark-toggle"' not in t:
    anchor = '''                                                <div
                                                    className="timeline-hashtag-editor"'''
    control = '''                                                <label
                                                    className="timeline-watermark-toggle"
                                                    onClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                    onDoubleClick={(event) =>
                                                        event.stopPropagation()
                                                    }
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(
                                                            item.watermark
                                                        )}
                                                        onChange={() =>
                                                            toggleTimelineWatermark(
                                                                item.id
                                                            )
                                                        }
                                                    />
                                                    <span>
                                                        Marca d'água
                                                    </span>
                                                </label>

'''

    t = must_replace(
        t,
        anchor,
        control + anchor,
        "app checkbox"
    )

p.write_text(t, encoding="utf-8")


# BROADCAST SETTINGS PANEL
p = Path(
    "src/renderer/src/BroadcastSettingsPanel.tsx"
)
t = p.read_text(encoding="utf-8")

if "WatermarkSettingsTab" not in t:
    t = must_replace(
        t,
        'import "./broadcast-settings.css";\n',
        'import "./broadcast-settings.css";\nimport WatermarkSettingsTab from "./WatermarkSettingsTab";\n',
        "settings import"
    )

if '| "watermark"' not in t:
    t = must_replace(
        t,
        'type SettingsTab =\n    | "output"\n    | "hashtag";',
        'type SettingsTab =\n    | "output"\n    | "watermark"\n    | "hashtag";',
        "settings type"
    )

if 'setTab("watermark")' not in t:
    marker = '''                    <button
                        type="button"
                        className={
                            tab === "hashtag"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("hashtag")
                        }
                    >
                        Hashtag / GC
                    </button>'''
    wm_button = '''                    <button
                        type="button"
                        className={
                            tab === "watermark"
                                ? "active"
                                : ""
                        }
                        onClick={() =>
                            setTab("watermark")
                        }
                    >
                        Marca d'água
                    </button>
''' + marker

    t = must_replace(
        t,
        marker,
        wm_button,
        "settings button"
    )

if "<WatermarkSettingsTab />" not in t:
    old = '''            {tab === "output" ? (
                <OutputTab
                    output={output}
                    patchOutput={patchOutput}
                    patchAudio={patchAudio}
                    patchNdi={patchNdi}
                    patchSrt={patchSrt}
                />
            ) : (
                <HashtagTab
                    style={hashtag}
                    patch={patchHashtag}
                />
            )}'''
    new = '''            {tab === "output" ? (
                <OutputTab
                    output={output}
                    patchOutput={patchOutput}
                    patchAudio={patchAudio}
                    patchNdi={patchNdi}
                    patchSrt={patchSrt}
                />
            ) : tab === "watermark" ? (
                <WatermarkSettingsTab />
            ) : (
                <HashtagTab
                    style={hashtag}
                    patch={patchHashtag}
                />
            )}'''

    t = must_replace(
        t,
        old,
        new,
        "settings content"
    )

if 'tab === "watermark"\n                            ? { display: "none" }' not in t:
    old = '''                    onClick={
                        tab === "output"
                            ? saveOutput
                            : saveHashtag
                    }
                >'''
    new = '''                    onClick={
                        tab === "output"
                            ? saveOutput
                            : tab === "hashtag"
                              ? saveHashtag
                              : undefined
                    }
                    style={
                        tab === "watermark"
                            ? { display: "none" }
                            : undefined
                    }
                >'''

    t = must_replace(
        t,
        old,
        new,
        "settings footer"
    )

p.write_text(t, encoding="utf-8")

print("watermark feature patch applied")
