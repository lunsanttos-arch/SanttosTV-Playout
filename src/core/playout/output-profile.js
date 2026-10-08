"use strict";

const FPS_RATIONALS = Object.freeze({
    "23.976": [24000, 1001],
    "24": [24, 1],
    "25": [25, 1],
    "29.97": [30000, 1001],
    "30": [30, 1],
    "50": [50, 1],
    "59.94": [60000, 1001],
    "60": [60, 1]
});

const PIXEL_FORMATS = Object.freeze({
    bgra: {
        ffmpeg: "bgra",
        ndi: "bgra",
        bytesPerFrame: (width, height) => width * height * 4
    },
    yuv422p: {
        // NDI consumes packed UYVY for 8-bit 4:2:2.
        ffmpeg: "uyvy422",
        ndi: "uyvy",
        bytesPerFrame: (width, height) => width * height * 2
    },
    yuv420p: {
        ffmpeg: "yuv420p",
        ndi: "i420",
        bytesPerFrame: (width, height) => (width * height * 3) / 2
    }
});

function parseResolution(value) {
    const match = /^(\d{3,4})x(\d{3,4})$/.exec(String(value || ""));
    if (!match) return { width: 1920, height: 1080 };

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 320 ||
        height < 240 ||
        width > 4096 ||
        height > 2160 ||
        width % 2 !== 0 ||
        height % 2 !== 0
    ) {
        return { width: 1920, height: 1080 };
    }

    return { width, height };
}

function outputProfile(output = {}) {
    const { width, height } = parseResolution(output.resolution);
    const fpsText = Object.hasOwn(FPS_RATIONALS, String(output.fps))
        ? String(output.fps)
        : "29.97";
    const [fpsN, fpsD] = FPS_RATIONALS[fpsText];
    const scanMode = output.scanMode === "interlaced"
        ? "interlaced"
        : "progressive";
    const aspectRatio = output.aspectRatio === "4:3"
        ? "4:3"
        : "16:9";
    const aspect = aspectRatio === "4:3" ? 4 / 3 : 16 / 9;
    const pixelKey = Object.hasOwn(PIXEL_FORMATS, output.pixelFormat)
        ? output.pixelFormat
        : "bgra";
    const pixel = PIXEL_FORMATS[pixelKey];
    const sampleRate = [44100, 48000].includes(Number(output.audio?.sampleRate))
        ? Number(output.audio.sampleRate)
        : 48000;
    const channels = Number(output.audio?.channels) === 1 ? 1 : 2;
    const sourceName = typeof output.ndi?.name === "string" &&
        output.ndi.name.trim()
        ? output.ndi.name.trim().slice(0, 120)
        : "Santtos TV - PROGRAM";
    const omtName = typeof output.omt?.name === "string" &&
        output.omt.name.trim()
        ? output.omt.name.trim().slice(0, 120)
        : "SanTTos Playout - PROGRAM";
    const omtQuality = ["default", "low", "medium", "high"].includes(
        String(output.omt?.quality)
    )
        ? String(output.omt.quality)
        : "low";

    // Sample aspect ratio required to produce the configured display aspect
    // ratio with the selected raster.
    const sar = aspect / (width / height);

    return {
        width,
        height,
        resolution: `${width}x${height}`,
        fpsText,
        fpsN,
        fpsD,
        fpsExpression: `${fpsN}/${fpsD}`,
        scanMode,
        aspectRatio,
        aspect,
        sar,
        pixelFormat: pixelKey,
        ffmpegPixelFormat: pixel.ffmpeg,
        ndiPixelFormat: pixel.ndi,
        frameSize: pixel.bytesPerFrame(width, height),
        sampleRate,
        channels,
        audioPacketSamples: Math.round(sampleRate / 50),
        ndiEnabled: output.ndi?.enabled !== false,
        sourceName,
        omtEnabled: output.omt?.enabled === true,
        omtName,
        omtQuality
    };
}

function profileSignature(profile) {
    return [
        profile.resolution,
        profile.fpsExpression,
        profile.scanMode,
        profile.aspectRatio,
        profile.ndiPixelFormat,
        profile.sampleRate,
        profile.channels,
        profile.sourceName,
        profile.ndiEnabled ? "ndi-on" : "ndi-off",
        profile.omtName,
        profile.omtQuality,
        profile.omtEnabled ? "omt-on" : "omt-off"
    ].join("|");
}

module.exports = {
    FPS_RATIONALS,
    PIXEL_FORMATS,
    parseResolution,
    outputProfile,
    profileSignature
};
