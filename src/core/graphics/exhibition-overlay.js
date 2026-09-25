"use strict";

// Single validation and geometry source for the CONFIGURACOES / IDENTIFICACAO
// and the native FFmpeg PROGRAM. Strings are allowlisted before drawtext.
const LABELS = Object.freeze({
    INEDITO: "INÉDITO",
    REPRISE: "REPRISE",
    ESTREIA: "ESTREIA",
    ESPECIAL: "ESPECIAL",
    AO_VIVO: "AO VIVO"
});
const FONTS = new Set(["Arial", "Segoe UI", "Tahoma", "Verdana", "Calibri"]);
const WIDTH = 1920;
const HEIGHT = 1080;

const DEFAULT_EXHIBITION_STYLE = Object.freeze({
    enabled: true,
    fontFamily: "Arial",
    fontSize: 26,
    bold: true,
    color: "#ffffff",
    opacity: 1,
    outlineWidth: 1,
    outlineColor: "#000000",
    outlineOpacity: 0.65,
    shadowEnabled: false,
    shadowColor: "#000000",
    shadowOpacity: 0.65,
    shadowX: 1,
    shadowY: 1,
    backgroundEnabled: false,
    backgroundColor: "#111111",
    backgroundOpacity: 0.78,
    backgroundPadding: 5,
    gapPx: 4,
    rightOffsetPx: 0,
    yOffsetPx: 0,
    labels: Object.freeze({ ...LABELS })
});

function clamp(value, fallback, min, max, integer = true) {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) return fallback;
    const bounded = Math.min(max, Math.max(min, number));
    return integer ? Math.round(bounded) : bounded;
}

function color(value, fallback) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
        ? value.toLowerCase() : fallback;
}

function normalizedLabels(labels) {
    const incoming = labels && typeof labels === "object" && !Array.isArray(labels)
        ? labels : {};
    const result = {};
    for (const [key, fallback] of Object.entries(LABELS)) {
        const candidate = incoming[key];
        result[key] = typeof candidate === "string" &&
            /^[\p{L}\p{N} .\/_-]{1,32}$/u.test(candidate.trim())
                ? candidate.trim() : fallback;
    }
    return result;
}

function normalizeExhibitionStyle(raw = {}) {
    const v = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const d = DEFAULT_EXHIBITION_STYLE;
    return {
        enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
        fontFamily: FONTS.has(v.fontFamily) ? v.fontFamily : d.fontFamily,
        fontSize: clamp(v.fontSize, d.fontSize, 12, 100),
        bold: typeof v.bold === "boolean" ? v.bold : d.bold,
        color: color(v.color, d.color),
        opacity: clamp(v.opacity, d.opacity, 0, 1, false),
        outlineWidth: clamp(v.outlineWidth, d.outlineWidth, 0, 8),
        outlineColor: color(v.outlineColor, d.outlineColor),
        outlineOpacity: clamp(v.outlineOpacity, d.outlineOpacity, 0, 1, false),
        shadowEnabled: typeof v.shadowEnabled === "boolean" ? v.shadowEnabled : d.shadowEnabled,
        shadowColor: color(v.shadowColor, d.shadowColor),
        shadowOpacity: clamp(v.shadowOpacity, d.shadowOpacity, 0, 1, false),
        shadowX: clamp(v.shadowX, d.shadowX, -20, 20),
        shadowY: clamp(v.shadowY, d.shadowY, -20, 20),
        backgroundEnabled: typeof v.backgroundEnabled === "boolean" ? v.backgroundEnabled : d.backgroundEnabled,
        backgroundColor: color(v.backgroundColor, d.backgroundColor),
        backgroundOpacity: clamp(v.backgroundOpacity, d.backgroundOpacity, 0, 1, false),
        backgroundPadding: clamp(v.backgroundPadding, d.backgroundPadding, 0, 24),
        gapPx: clamp(v.gapPx, d.gapPx, 0, 120),
        rightOffsetPx: clamp(v.rightOffsetPx, d.rightOffsetPx, -600, 600),
        yOffsetPx: clamp(v.yOffsetPx, d.yOffsetPx, -400, 400),
        labels: normalizedLabels(v.labels)
    };
}

function getExhibitionOverlay(type, watermarkStyle = {}, style = undefined) {
    if (!Object.hasOwn(LABELS, type)) return null;
    const cfg = normalizeExhibitionStyle(style);
    if (!cfg.enabled) return null;
    const logoX = clamp(watermarkStyle.x, 1680, 0, WIDTH);
    const logoY = clamp(watermarkStyle.y, 40, 0, HEIGHT);
    const logoWidth = clamp(watermarkStyle.widthPx, 180, 1, WIDTH);
    const right = clamp(logoX + logoWidth + cfg.rightOffsetPx, 1860, 8 + cfg.backgroundPadding, WIDTH - 8 - cfg.backgroundPadding);
    const top = clamp(logoY - cfg.fontSize - cfg.backgroundPadding * 2 - cfg.gapPx + cfg.yOffsetPx, 8, 8, HEIGHT - cfg.fontSize);
    return { text: cfg.labels[type], right, top, fontSize: cfg.fontSize, padding: cfg.backgroundPadding };
}

function ffmpegColor(hex, opacity) {
    return `0x${hex.slice(1)}@${opacity.toFixed(3)}`;
}

// Used only on validated short editorial copy. Do not interpolate raw metadata.
function escapeText(text) {
    return text.replaceAll("\\", "\\\\")
        .replaceAll(":", "\\:")
        .replaceAll("'", "\\'")
        .replaceAll("%", "\\%")
        .replaceAll(",", "\\,")
        .replaceAll("[", "\\[")
        .replaceAll("]", "\\]");
}

function buildExhibitionDrawtext(inputLabel, type, watermarkStyle, fontFile, style = undefined) {
    const cfg = normalizeExhibitionStyle(style);
    const overlay = getExhibitionOverlay(type, watermarkStyle, cfg);
    if (!overlay) return null;
    if (typeof inputLabel !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(inputLabel)) {
        throw new TypeError("Invalid FFmpeg input label.");
    }
    if (typeof fontFile !== "string" || !fontFile) {
        throw new TypeError("An existing caption font is required.");
    }

    const options = [
        `fontfile='${fontFile}'`,
        `text='${escapeText(overlay.text)}'`,
        `fontsize=${overlay.fontSize}`,
        `fontcolor=${ffmpegColor(cfg.color, cfg.opacity)}`,
        `borderw=${cfg.outlineWidth}`,
        `bordercolor=${ffmpegColor(cfg.outlineColor, cfg.outlineOpacity)}`,
        `x='max(8\\,min(w-text_w-8\\,${overlay.right}-text_w))'`,
        `y=${overlay.top}`
    ];
    if (cfg.backgroundEnabled) {
        options.push("box=1",
            `boxcolor=${ffmpegColor(cfg.backgroundColor, cfg.backgroundOpacity)}`,
            `boxborderw=${cfg.backgroundPadding}`);
    }
    if (cfg.shadowEnabled) {
        options.push(
            `shadowcolor=${ffmpegColor(cfg.shadowColor, cfg.shadowOpacity)}`,
            `shadowx=${cfg.shadowX}`,
            `shadowy=${cfg.shadowY}`
        );
    }
    return `[${inputLabel}]drawtext=${options.join(":")}[exhibition]`;
}

module.exports = {
    LABELS,
    DEFAULT_EXHIBITION_STYLE,
    normalizeExhibitionStyle,
    getExhibitionOverlay,
    buildExhibitionDrawtext
};
