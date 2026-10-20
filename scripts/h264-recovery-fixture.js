"use strict";
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { resolveMediaRuntime } = require("../src/core/media/runtime-paths");
function createRecoveryFixture(file) {
    execFileSync(resolveMediaRuntime("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
        "-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "4", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast",
        "-g", "1", "-c:a", "aac", "-movflags", "+faststart", "-y", file]);
    const probe = JSON.parse(execFileSync(resolveMediaRuntime("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_packets", "-of", "json", file], { encoding: "utf8" }));
    const packet = probe.packets[0], bytes = fs.readFileSync(file), stsz = bytes.indexOf(Buffer.from("stsz"));
    if (stsz < 0 || bytes.readUInt32BE(stsz + 8) !== 0 || bytes.readUInt32BE(stsz + 16) !== Number(packet.size)) throw Error("Unexpected fixture sample table");
    // The first MP4 sample contains only a 9-byte AUD and no picture. Later chunks keep their offsets.
    bytes.writeUInt32BE(9, stsz + 16);
    Buffer.from([0, 0, 0, 5, 9, 240, 0, 0, 0]).copy(bytes, Number(packet.pos));
    fs.writeFileSync(file, bytes);
}
module.exports = { createRecoveryFixture };
