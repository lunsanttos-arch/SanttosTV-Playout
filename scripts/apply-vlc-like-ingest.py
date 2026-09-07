from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Anchor not found: {label}")
    return text.replace(old, new, 1)

# main.js
p = Path("src/main/main.js")
t = p.read_text(encoding="utf-8")

# Let the filter graph target the stream chosen by ffprobe instead of blindly using 0:v:0.
old = '''function buildProgramFilterGraph(\n    hashtag,\n    overlayState,\n    hasWatermarkInput\n) {'''
new = '''function buildProgramFilterGraph(\n    hashtag,\n    overlayState,\n    hasWatermarkInput,\n    videoStreamIndex = null\n) {'''
t = replace_once(t, old, new, "filter graph signature")

old = '''    const chains = [\n        "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]"\n    ];'''
new = '''    const sourceVideo =\n        Number.isInteger(Number(videoStreamIndex))\n            ? `[0:${Number(videoStreamIndex)}]`\n            : "[0:v:0]";\n\n    const chains = [\n        `${sourceVideo}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30000/1001[base]`\n    ];'''
t = replace_once(t, old, new, "selected video stream source")

# Resilient FFmpeg input options. Keep software decode as the guaranteed baseline.
old = '''    const args = [\n        "-hide_banner",\n        "-loglevel",\n        "warning",\n        "-nostdin"\n    ];'''
new = '''    const args = [\n        "-hide_banner",\n        "-loglevel",\n        "warning",\n        "-nostdin",\n        "-fflags",\n        "+genpts+discardcorrupt",\n        "-err_detect",\n        "ignore_err",\n        "-probesize",\n        "10000000",\n        "-analyzeduration",\n        "10000000"\n    ];'''
t = replace_once(t, old, new, "resilient input args")

old = '''        buildProgramFilterGraph(\n            hashtag,\n            programState,\n            watermarkEnabled\n        ),'''
new = '''        buildProgramFilterGraph(\n            hashtag,\n            programState,\n            watermarkEnabled,\n            programState.videoStreamIndex\n        ),'''
t = replace_once(t, old, new, "pass selected stream to filter")

# Add diagnostics for chosen stream/timing profile.
old = '''            ` | hashtag=${hashtag ? "ON" : "OFF"}`\n    );'''
new = '''            ` | hashtag=${hashtag ? "ON" : "OFF"}` +\n            ` | vstream=${programState.videoStreamIndex ?? "auto"}` +\n            ` | timing=${programState.timingMode ?? "unknown"}`\n    );'''
t = replace_once(t, old, new, "stream diagnostics")

p.write_text(t, encoding="utf-8")

# App.tsx - carry analyzer stream/timing metadata into the native engine command.
p = Path("src/renderer/src/App.tsx")
t = p.read_text(encoding="utf-8")

old = '''    audioCodec: string | null;\n    thumbnail: string | null;'''
new = '''    audioCodec: string | null;\n    videoStreamIndex?: number | null;\n    audioStreamIndex?: number | null;\n    timingMode?: "cfr" | "vfr" | "unknown";\n    isVariableFrameRate?: boolean;\n    rotation?: number;\n    sampleAspectRatio?: string | null;\n    thumbnail: string | null;'''
t = replace_once(t, old, new, "media ingest metadata type")

old = '''                    hashtagFadeOut?: boolean;\n                }'''
new = '''                    hashtagFadeOut?: boolean;\n                    videoStreamIndex?: number | null;\n                    timingMode?: string;\n                }'''
t = replace_once(t, old, new, "overlay command type")

old = '''            hashtagFadeOut:\n                Boolean(mediaItem.hashtag) &&\n                !Boolean(following?.hashtag)\n        };'''
new = '''            hashtagFadeOut:\n                Boolean(mediaItem.hashtag) &&\n                !Boolean(following?.hashtag),\n            videoStreamIndex:\n                mediaItem.videoStreamIndex ?? null,\n            timingMode:\n                mediaItem.timingMode ?? "unknown"\n        };'''
t = replace_once(t, old, new, "forward selected stream metadata")

p.write_text(t, encoding="utf-8")
print("VLC-like resilient ingest patch applied")
