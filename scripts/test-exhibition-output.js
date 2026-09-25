"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ffmpegStatic = require("ffmpeg-static");
const {
    getExhibitionOverlay,
    buildExhibitionDrawtext,
    normalizeExhibitionStyle
} = require("../src/core/graphics/exhibition-overlay");

const defaultLogo = { x: 1680, y: 40, widthPx: 180 };
assert.equal(getExhibitionOverlay("NORMAL", defaultLogo), null);
assert.equal(getExhibitionOverlay("invalid;drawtext=evil", defaultLogo), null);
assert.deepEqual(getExhibitionOverlay("INEDITO", defaultLogo), {
    text: "INÉDITO",
    right: 1860,
    top: 8,
    fontSize: 26,
    padding: 5
});
assert.equal(getExhibitionOverlay("REPRISE", defaultLogo).text, "REPRISE");
assert.equal(getExhibitionOverlay("AO_VIVO", defaultLogo).text, "AO VIVO");
assert.equal(getExhibitionOverlay("REPRISE", { x: 99999, y: -50, widthPx: 100 }).right, 1907);
assert.throws(
    () => buildExhibitionDrawtext("bad] ; [0:v]", "REPRISE", defaultLogo, "arial.ttf"),
    /input label/
);
assert.equal(buildExhibitionDrawtext("base", "NORMAL", defaultLogo, "arial.ttf"), null);

const custom = normalizeExhibitionStyle({
    fontFamily: "Tahoma",
    fontSize: 38,
    color: "#f0c020",
    outlineWidth: 3,
    shadowEnabled: true,
    shadowX: 3,
    backgroundEnabled: true,
    backgroundColor: "#225588",
    backgroundPadding: 8,
    gapPx: 14,
    rightOffsetPx: -35,
    yOffsetPx: 5,
    labels: { REPRISE: "OUTRA EXIBIÇÃO" }
});
assert.equal(getExhibitionOverlay("REPRISE", { x: 1650, y: 160, widthPx: 200 }, custom).text,
    "OUTRA EXIBIÇÃO");
assert.equal(getExhibitionOverlay("REPRISE", { x: 1650, y: 160, widthPx: 200 }, custom).right, 1815);
assert.equal(getExhibitionOverlay("REPRISE", defaultLogo, { enabled: false }), null);
const customFilter = buildExhibitionDrawtext("base", "REPRISE", defaultLogo,
    "arial.ttf", custom);
assert(customFilter.includes("fontsize=38"));
assert(customFilter.includes("fontcolor=0xf0c020@1.000"));
assert(customFilter.includes("borderw=3"));
assert(customFilter.includes("box=1"));
assert(customFilter.includes("shadowx=3"));
assert(!buildExhibitionDrawtext("base", "REPRISE", defaultLogo, "arial.ttf",
    { labels: { REPRISE: "expr=%{metadata}" } }).includes("expr="),
    "Textos não autorizados devem voltar ao padrão.");


// Render a full-HD frame with the exact filter used by the PROGRAM pipeline.
// Parsing tests alone would miss an invalid FFmpeg expression on Windows.
const fonts = process.platform === "win32"
    ? [
        path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "arialbd.ttf"),
        path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "seguisb.ttf")
    ]
    : [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
    ];
const selectedFont = fonts.find((font) => fs.existsSync(font));
assert(selectedFont, "Nao foi encontrada uma fonte para validar o desenho do PROGRAM.");
assert(ffmpegStatic && fs.existsSync(ffmpegStatic), "FFmpeg nao instalado no QA.");

const fontForFilter = selectedFont.replaceAll("\\", "/").replace(":", "\\:");
for (const status of ["INEDITO", "REPRISE", "AO_VIVO"]) {
    const captionFilter = buildExhibitionDrawtext(
        "base",
        status,
        defaultLogo,
        fontForFilter
    );
    assert(!captionFilter.includes("box=1"),
        `${status}: editorial caption must not have a background box.`);
    assert(!captionFilter.includes("boxcolor="),
        `${status}: editorial caption must not have a box color.`);
    assert(captionFilter.includes("borderw=1"),
        `${status}: editorial caption should retain a subtle outline.`);
    const filterGraph = `[0:v]drawbox=x=1680:y=40:w=180:h=120:color=gray:t=fill[base];${captionFilter};[exhibition]null[program]`;
    const rawFrame = execFileSync(ffmpegStatic, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=black:s=1920x1080:r=1:d=0.1",
        "-filter_complex", filterGraph,
        "-map", "[program]",
        "-frames:v", "1",
        "-pix_fmt", "rgb24",
        "-f", "rawvideo",
        "-"
    ], {
        windowsHide: true,
        timeout: 25000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
    });
    assert.equal(rawFrame.length, 1920 * 1080 * 3, "Frame Full HD incompleto.");

    // Detect actual white letter pixels inside the region ABOVE the simulated
    // gray logo. A successful FFmpeg process without pixels would be a false QA.
    let whitePixelsAboveLogo = 0;
    for (let y = 8; y < 40; y++) {
        for (let x = 1500; x < 1900; x++) {
            const offset = (y * 1920 + x) * 3;
            if (rawFrame[offset] > 195 &&
                rawFrame[offset + 1] > 195 &&
                rawFrame[offset + 2] > 195) {
                whitePixelsAboveLogo++;
            }
        }
    }
    assert(whitePixelsAboveLogo > 25,
        `${status}: missing caption above logo in rendered PROGRAM frame.`);

    // The logo itself remains visible and is not replaced by the badge.
    const logoPixel = (95 * 1920 + 1700) * 3;
    assert(rawFrame[logoPixel] > 60 && rawFrame[logoPixel] < 190,
        `${status}: synthetic logo was overwritten or disappeared.`);
}

const customGraph = "[0:v]null[base];" +
    buildExhibitionDrawtext("base", "REPRISE", { x: 1660, y: 165, widthPx: 190 },
        fontForFilter, custom) +
    ";[exhibition]null[program]";
const customFrame = execFileSync(ffmpegStatic, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=1:d=0.1",
    "-filter_complex", customGraph, "-map", "[program]",
    "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"
], {
    windowsHide: true,
    timeout: 25000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
});
assert.equal(customFrame.length, 1920 * 1080 * 3,
    "Configuração personalizada precisa gerar um quadro de vídeo válido.");
// Verify a nonblack caption rectangle in its personalized location, not
// merely that FFmpeg accepted arguments.
let customPixels = 0;
for (let y = 95; y < 140; y++) {
    for (let x = 1420; x < 1830; x++) {
        const offset = (y * 1920 + x) * 3;
        if (customFrame[offset] + customFrame[offset + 1] + customFrame[offset + 2] > 120) {
            customPixels++;
        }
    }
}
assert(customPixels > 1000, "A tarja opcional e o texto personalizado precisam ser desenhados.");
console.log("EXHIBITION OUTPUT QA: APROVADO — padrões sem tarja e estilo personalizado com tarja renderizados no FFmpeg.");

