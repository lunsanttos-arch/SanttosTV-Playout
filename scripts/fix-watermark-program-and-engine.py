from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)

# App.tsx
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

if "interface WatermarkStyle" not in t:
    t = replace_once(
        t,
        '''interface HashtagStyle {''',
        '''interface WatermarkStyle {
    filePath: string;
    widthPx: number;
    x: number;
    y: number;
    opacity: number;
    fadeMs: number;
}

interface HashtagStyle {''',
        "watermark type",
    )

if "watermarkStyle: WatermarkStyle;" not in t:
    t = replace_once(
        t,
        '''    ndiName: string;
    hashtagStyle: HashtagStyle;''',
        '''    ndiName: string;
    watermarkStyle: WatermarkStyle;
    hashtagStyle: HashtagStyle;''',
        "app settings watermark",
    )

if "const DEFAULT_WATERMARK_STYLE" not in t:
    t = replace_once(
        t,
        '''const DEFAULT_HASHTAG_STYLE: HashtagStyle = {''',
        '''const DEFAULT_WATERMARK_STYLE: WatermarkStyle = {
    filePath: "",
    widthPx: 180,
    x: 1680,
    y: 40,
    opacity: 0.82,
    fadeMs: 200
};

const DEFAULT_HASHTAG_STYLE: HashtagStyle = {''',
        "default watermark style",
    )

# Expand renderer API type so the 4th play argument and preview IPC are represented correctly.
t = t.replace(
    '''            playNdiFile: (
                filePath: string,
                startSeconds?: number,
                hashtag?: string
            ) => Promise<NdiCommandResult>;''',
    '''            playNdiFile: (
                filePath: string,
                startSeconds?: number,
                hashtag?: string,
                overlayState?: {
                    durationSeconds?: number;
                    watermarkEnabled?: boolean;
                    watermarkFadeIn?: boolean;
                    watermarkFadeOut?: boolean;
                    hashtagFadeIn?: boolean;
                    hashtagFadeOut?: boolean;
                }
            ) => Promise<NdiCommandResult>;
            getWatermarkPreview: (
                filePath: string
            ) => Promise<{
                ok: boolean;
                dataUrl?: string;
                error?: string;
            }>;''',
)

# State inside PlayoutPanel
anchor = '''    const [draggedMediaId, setDraggedMediaId] =
        useState<string | null>(null);'''
if "watermarkPreviewUrl" not in t:
    t = replace_once(
        t,
        anchor,
        anchor + '''
    const [watermarkStyle, setWatermarkStyle] =
        useState<WatermarkStyle>(
            DEFAULT_WATERMARK_STYLE
        );
    const [watermarkPreviewUrl, setWatermarkPreviewUrl] =
        useState("");''',
        "playout watermark state",
    )

# Load watermark config + preview when playout mounts.
anchor = '''    useEffect(() => {
        let cancelled = false;

        window.santtosAPI
            .getTimeline()'''
if "loadWatermarkForProgram" not in t:
    effect = '''    useEffect(() => {
        let cancelled = false;

        async function loadWatermarkForProgram() {
            try {
                const settings =
                    await window.santtosAPI.getSettings();
                const style =
                    settings.watermarkStyle ??
                    DEFAULT_WATERMARK_STYLE;

                if (cancelled) {
                    return;
                }

                setWatermarkStyle(style);
                setWatermarkPreviewUrl("");

                if (!style.filePath) {
                    return;
                }

                const result =
                    await window.santtosAPI
                        .getWatermarkPreview(
                            style.filePath
                        );

                if (
                    !cancelled &&
                    result?.ok &&
                    result.dataUrl
                ) {
                    setWatermarkPreviewUrl(
                        result.dataUrl
                    );
                }
            } catch (error) {
                console.error(
                    "Erro ao carregar marca d'água do PROGRAM:",
                    error
                );
            }
        }

        loadWatermarkForProgram();

        return () => {
            cancelled = true;
        };
    }, []);

'''
    t = replace_once(t, anchor, effect + anchor, "load watermark in program")

# Previous item and intelligent alpha calculations.
anchor = '''    const nextMedia =
        selectedMediaIndex >= 0
            ? timelineQueue[
                  selectedMediaIndex + 1
              ] ?? null
            : null;'''
if "const previousMedia" not in t:
    addition = anchor + '''

    const previousMedia =
        selectedMediaIndex > 0
            ? timelineQueue[
                  selectedMediaIndex - 1
              ] ?? null
            : null;

    const watermarkFadeSeconds = Math.max(
        0,
        watermarkStyle.fadeMs / 1000
    );
    const watermarkPreviewOpacity =
        getOverlayPreviewOpacity({
            active: Boolean(
                selectedMedia?.watermark
            ),
            previousActive: Boolean(
                previousMedia?.watermark
            ),
            nextActive: Boolean(
                nextMedia?.watermark
            ),
            currentTime,
            duration,
            fadeSeconds:
                watermarkFadeSeconds
        });
    const hashtagPreviewOpacity =
        getOverlayPreviewOpacity({
            active: Boolean(
                selectedMedia?.hashtag
            ),
            previousActive: Boolean(
                previousMedia?.hashtag
            ),
            nextActive: Boolean(
                nextMedia?.hashtag
            ),
            currentTime,
            duration,
            fadeSeconds: 0.2
        });'''
    t = replace_once(t, anchor, addition, "overlay preview alpha")

# Render watermark and apply hashtag alpha.
old = '''                                {selectedMedia?.hashtag && (
                                    <div
                                        className="program-hashtag"
                                        style={
                                            getHashtagPreviewStyle(
                                                hashtagStyle
                                            )
                                        }
                                    >
                                        {selectedMedia.hashtag}
                                    </div>
                                )}'''
new = '''                                {watermarkPreviewUrl && (
                                    <img
                                        className="program-watermark"
                                        src={watermarkPreviewUrl}
                                        alt="Marca d'água do PROGRAM"
                                        style={{
                                            left: `${(watermarkStyle.x / 1920) * 100}%`,
                                            top: `${(watermarkStyle.y / 1080) * 100}%`,
                                            width: `${(watermarkStyle.widthPx / 1920) * 100}%`,
                                            opacity:
                                                watermarkPreviewOpacity *
                                                watermarkStyle.opacity
                                        }}
                                    />
                                )}

                                {selectedMedia?.hashtag && (
                                    <div
                                        className="program-hashtag"
                                        style={{
                                            ...getHashtagPreviewStyle(
                                                hashtagStyle
                                            ),
                                            opacity:
                                                hashtagPreviewOpacity
                                        }}
                                    >
                                        {selectedMedia.hashtag}
                                    </div>
                                )}'''
t = replace_once(t, old, new, "program watermark render")

# Add helper before getHashtagPreviewStyle.
anchor = '''function getHashtagPreviewStyle(
    style: HashtagStyle
): CSSProperties {'''
if "function getOverlayPreviewOpacity" not in t:
    helper = '''function getOverlayPreviewOpacity({
    active,
    previousActive,
    nextActive,
    currentTime,
    duration,
    fadeSeconds
}: {
    active: boolean;
    previousActive: boolean;
    nextActive: boolean;
    currentTime: number;
    duration: number;
    fadeSeconds: number;
}) {
    if (!active) {
        return 0;
    }

    if (fadeSeconds <= 0) {
        return 1;
    }

    let alpha = 1;

    if (
        !previousActive &&
        currentTime < fadeSeconds
    ) {
        alpha = Math.min(
            alpha,
            currentTime / fadeSeconds
        );
    }

    const remaining =
        duration > 0
            ? duration - currentTime
            : Number.POSITIVE_INFINITY;

    if (
        !nextActive &&
        remaining < fadeSeconds
    ) {
        alpha = Math.min(
            alpha,
            remaining / fadeSeconds
        );
    }

    return Math.max(0, Math.min(1, alpha));
}

'''
    t = replace_once(t, anchor, helper + anchor, "overlay alpha helper")

p.write_text(t, encoding="utf-8")

# styles.css: PROGRAM watermark is positioned in the final PROGRAM canvas.
p = Path("src/renderer/src/styles.css")
t = p.read_text(encoding="utf-8")
if ".program-watermark" not in t:
    t += '''

.program-watermark {
    position: absolute;
    z-index: 18;
    height: auto;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
    transition: opacity 40ms linear;
}
'''
p.write_text(t, encoding="utf-8")

# main.js: add explicit diagnostics and use repeatlast to make still-image overlay robust.
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    ''':shortest=1[watermarked]`''',
    ''':shortest=1:repeatlast=1[watermarked]`''',
)
old = '''    const programState = {
        ...(overlayState && typeof overlayState === "object"
            ? overlayState
            : {}),
        startSeconds:
            normalizedStartSeconds
    };'''
new = old + '''

    console.log(
        `[GC] watermark=${watermarkEnabled ? "ON" : "OFF"}` +
            ` | file=${watermarkStyle?.filePath || "none"}` +
            ` | fadeIn=${Boolean(programState.watermarkFadeIn)}` +
            ` | fadeOut=${Boolean(programState.watermarkFadeOut)}` +
            ` | hashtag=${hashtag ? "ON" : "OFF"}`
    );'''
if "[GC] watermark=" not in t:
    t = replace_once(t, old, new, "watermark diagnostics")
p.write_text(t, encoding="utf-8")

print("watermark PROGRAM and engine patch applied")
