from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)

# database.js: accept the same broad container set exposed by the picker.
p = Path("src/database/database.js")
t = p.read_text(encoding="utf-8")
old = '''        if (!["mp4", "mov"].includes(extension)) {
            continue;
        }'''
new = '''        const supportedContainers = new Set([
            "mp4",
            "mov",
            "mkv",
            "avi",
            "mxf",
            "ts",
            "mts",
            "m2ts",
            "webm",
            "mpg",
            "mpeg",
            "m4v",
            "wmv"
        ]);

        if (!supportedContainers.has(extension)) {
            continue;
        }'''
t = replace_once(t, old, new, "database container filter")
p.write_text(t, encoding="utf-8")

# main.js: decoder preflight + resilient FFmpeg input + selected stream mapping.
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")

anchor = '''const {
    probeMedia
} = require(
    "../core/media/ffprobe"
);'''
addition = anchor + '''

const {
    checkMediaDecode
} = require(
    "../core/media/decode-check"
);'''
if "checkMediaDecode" not in t:
    t = replace_once(t, anchor, addition, "decode check import")

old = '''            const metadata =
                await probeMedia(mediaItem.path);

            updateMediaMetadata(
                mediaItem.id,
                {
                    ...metadata,
                    analysisCompletedAt:
                        new Date().toISOString()
                }
            );'''
new = '''            const metadata =
                await probeMedia(mediaItem.path);

            const decodeSupport =
                await checkMediaDecode(
                    mediaItem.path,
                    metadata.videoStreamIndex
                );

            const compatibility = {
                ...(metadata.compatibility ?? {}),
                issues: [
                    ...(metadata.compatibility?.issues ?? [])
                ],
                warnings: [
                    ...(metadata.compatibility?.warnings ?? [])
                ]
            };

            if (!decodeSupport.decodable) {
                compatibility.issues.push(
                    "O FFmpeg não conseguiu decodificar a faixa de vídeo nem por hardware nem por software."
                );
            } else if (
                decodeSupport.preferredMode === "software"
            ) {
                compatibility.warnings.push(
                    "A aceleração por hardware não ficou disponível para esta mídia; o engine usará fallback de software."
                );
            }

            updateMediaMetadata(
                mediaItem.id,
                {
                    ...metadata,
                    status:
                        decodeSupport.decodable
                            ? metadata.status
                            : "incompatible",
                    compatibility,
                    decodeSupport,
                    decoderMode:
                        decodeSupport.preferredMode,
                    hardwareDecodeAvailable:
                        decodeSupport.hardwareAvailable,
                    analysisCompletedAt:
                        new Date().toISOString()
                }
            );'''
t = replace_once(t, old, new, "decode preflight analysis")\n
# Filter graph must target the video stream selected by ffprobe.
old = '''function buildProgramFilterGraph(
    hashtag,
    overlayState,
    hasWatermarkInput
) {'''
new = '''function buildProgramFilterGraph(
    hashtag,
    overlayState,
    hasWatermarkInput,
    videoStreamIndex = null
) {'''
if old in t:
    t = replace_once(t, old, new, "filter signature")

old = '''    const chains = [
        "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]"
    ];'''
new = '''    const sourceVideo =
        Number.isInteger(Number(videoStreamIndex))
            ? `[0:${Number(videoStreamIndex)}]`
            : "[0:v:0]";

    const chains = [
        `${sourceVideo}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]`
    ];'''
if old in t:
    t = replace_once(t, old, new, "selected video filter input")

old = '''    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin"
    ];'''
new = '''    const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-fflags",
        "+genpts+discardcorrupt",
        "-err_detect",
        "ignore_err",
        "-probesize",
        "10000000",
        "-analyzeduration",
        "10000000"
    ];'''
if old in t:
    t = replace_once(t, old, new, "resilient ffmpeg input")

old = '''        buildProgramFilterGraph(
            hashtag,
            programState,
            watermarkEnabled
        ),'''
new = '''        buildProgramFilterGraph(
            hashtag,
            programState,
            watermarkEnabled,
            programState.videoStreamIndex
        ),'''
if old in t:
    t = replace_once(t, old, new, "pass selected stream")

old = '''            ` | hashtag=${hashtag ? "ON" : "OFF"}`
    );'''
new = '''            ` | hashtag=${hashtag ? "ON" : "OFF"}` +
            ` | vstream=${programState.videoStreamIndex ?? "auto"}` +
            ` | astream=${programState.audioStreamIndex ?? "01"}` +
            ` | timing=${programState.timingMode ?? "unknown"}`
    );'''
if old in t:
    t = replace_once(t, old, new, "stream diagnostics")

p.write_text(t, encoding="utf-8")

# App.tsx: carry the selected streams/timing into the engine command.
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

old = '''    audioCodec: string | null;
    thumbnail: string | null;'''
new = '''    audioCodec: string | null;
    videoStreamIndex?: number | null;
    audioStreamIndex?: number | null;
    timingMode?: "cfr" | "vfr" | "unknown";
    isVariableFrameRate?: boolean;
    rotation?: number;
    sampleAspectRatio?: string | null;
    decoderMode?: "hardware" | "software" | "unavailable";
    thumbnail: string | null;'''
if old in t:
    t = replace_once(t, old, new, "media ingest metadata")

old = '''                    hashtagFadeOut?: boolean;
                }'''
new = '''                    hashtagFadeOut?: boolean;
                    videoStreamIndex?: number | null;
                    audioStreamIndex?: number | null;
                    timingMode?: string;
                }'''
if old in t:
    t = replace_once(t, old, new, "engine overlay state type")

old = '''            hashtagFadeOut:
                Boolean(mediaItem.hashtag) &&
                !Boolean(following?.hashtag)
        };'''
new = '''            hashtagFadeOut:
                Boolean(mediaItem.hashtag) &&
                !Boolean(following?.hashtag),
            videoStreamIndex:
                mediaItem.videoStreamIndex ?? null,
            audioStreamIndex:
                mediaItem.audioStreamIndex ?? null,
            timingMode:
                mediaItem.timingMode ?? "unknown"
        };'''
if old in t:
    t = replace_once(t, old, new, "forward ingest metadata")

p.write_text(t, encoding="utf-8")
print("resilient ingest v2 applied")
