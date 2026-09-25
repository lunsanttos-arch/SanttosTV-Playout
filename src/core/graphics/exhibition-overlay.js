"use strict";

// Editorial labels shown ON the PROGRAM picture, not just in the operator UI.
// Only known values are accepted: the string passed to FFmpeg cannot contain
// arbitrary drawtext expressions from imported metadata.
const LABELS = Object.freeze({
    INEDITO: "INÉDITO",
    REPRISE: "REPRISE",
    ESTREIA: "ESTREIA",
    ESPECIAL: "ESPECIAL",
    AO_VIVO: "AO VIVO"
});

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const LABEL_FONT_SIZE = 26;
const LABEL_BOX_PADDING = 5;

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number)
        ? Math.min(max, Math.max(min, Math.round(number)))
        : fallback;
}

function getExhibitionOverlay(type, watermarkStyle = {}) {
    const text = LABELS[type];
    if (!text) return null; // NORMAL and unknown values have no PROGRAM label.

    const logoX = clamp(watermarkStyle.x, 1680, 0, OUTPUT_WIDTH);
    const logoY = clamp(watermarkStyle.y, 40, 0, OUTPUT_HEIGHT);
    const logoWidth = clamp(watermarkStyle.widthPx, 180, 1, OUTPUT_WIDTH);

    // Right-align to the logo, keep the entire caption on-screen.
    const right = clamp(
        logoX + logoWidth,
        1860,
        LABEL_BOX_PADDING + 8,
        OUTPUT_WIDTH - LABEL_BOX_PADDING - 8
    );

    // A 26px caption plus 5px padding fits above the default logo at y=40.
    // If the logo touches the top edge, the caption is clamped on-screen.
    const top = Math.max(8, logoY - (LABEL_FONT_SIZE + LABEL_BOX_PADDING * 2 + 4));

    return {
        text,
        right,
        top,
        fontSize: LABEL_FONT_SIZE,
        padding: LABEL_BOX_PADDING
    };
}

function buildExhibitionDrawtext(inputLabel, type, watermarkStyle, fontFile) {
    const overlay = getExhibitionOverlay(type, watermarkStyle);
    if (!overlay) return null;
    if (typeof inputLabel !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(inputLabel)) {
        throw new TypeError("Invalid FFmpeg input label.");
    }
    if (typeof fontFile !== "string" || !fontFile) {
        throw new TypeError("An existing caption font is required.");
    }

    // The escaping of the Windows fontfile path is already handled by
    // resolveHashtagFont() in the Electron main process.
    const options = [
        `fontfile='${fontFile}'`,
        `text='${overlay.text}'`,
        `fontsize=${overlay.fontSize}`,
        "fontcolor=white",
        "box=1",
        "boxcolor=0x111111@0.78",
        `boxborderw=${overlay.padding}`,
        // FFmpeg filtergraph expressions require escaped commas.
        `x='max(8\\,min(w-text_w-8\\,${overlay.right}-text_w))'`,
        `y=${overlay.top}`
    ];

    return `[${inputLabel}]drawtext=${options.join(":")}[exhibition]`;
}

module.exports = {
    LABELS,
    getExhibitionOverlay,
    buildExhibitionDrawtext
};
