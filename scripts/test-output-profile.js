"use strict";

const assert = require("node:assert/strict");
const {
    outputProfile,
    profileSignature
} = require("../src/core/playout/output-profile");

const hd = outputProfile({
    resolution: "1280x720",
    fps: "59.94",
    scanMode: "progressive",
    aspectRatio: "16:9",
    pixelFormat: "bgra",
    audio: { sampleRate: 48000, channels: 2 },
    ndi: { enabled: true, name: "Santtos HD" }
});
assert.equal(hd.width, 1280);
assert.equal(hd.height, 720);
assert.equal(hd.fpsN, 60000);
assert.equal(hd.fpsD, 1001);
assert.equal(hd.frameSize, 1280 * 720 * 4);
assert.equal(hd.ffmpegPixelFormat, "bgra");
assert.equal(hd.ndiPixelFormat, "bgra");
assert.equal(hd.sourceName, "Santtos HD");

const sd422 = outputProfile({
    resolution: "720x576",
    fps: "25",
    scanMode: "interlaced",
    aspectRatio: "4:3",
    pixelFormat: "yuv422p",
    audio: { sampleRate: 44100, channels: 1 },
    ndi: { enabled: true, name: "Santtos SD" }
});
assert.equal(sd422.frameSize, 720 * 576 * 2);
assert.equal(sd422.ffmpegPixelFormat, "uyvy422");
assert.equal(sd422.ndiPixelFormat, "uyvy");
assert.equal(sd422.scanMode, "interlaced");
assert.equal(sd422.sampleRate, 44100);
assert.equal(sd422.channels, 1);
assert(Math.abs(sd422.aspect - 4 / 3) < 0.00001);
assert(Math.abs(sd422.sar - (16 / 15)) < 0.00001);

const uhd420 = outputProfile({
    resolution: "3840x2160",
    fps: "50",
    scanMode: "progressive",
    aspectRatio: "16:9",
    pixelFormat: "yuv420p",
    audio: { sampleRate: 48000, channels: 2 },
    ndi: { enabled: false, name: "Santtos UHD" }
});
assert.equal(uhd420.frameSize, 3840 * 2160 * 3 / 2);
assert.equal(uhd420.ffmpegPixelFormat, "yuv420p");
assert.equal(uhd420.ndiPixelFormat, "i420");
assert.equal(uhd420.ndiEnabled, false);

assert.notEqual(
    profileSignature(hd),
    profileSignature(sd422),
    "Perfis tecnicamente diferentes devem reiniciar o sender."
);

console.log(
    "OUTPUT PROFILE QA: APROVADO — resolução, FPS, scan, DAR, pixel format e PCM."
);
