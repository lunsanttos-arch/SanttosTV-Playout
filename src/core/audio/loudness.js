"use strict";

const TARGET_LUFS = -23;
const ANALYSIS_VERSION = 1;

function parseLoudness(stderr) {
    const summaries = String(stderr).match(/\{[^{}]*"input_i"[^{}]*\}/g) || [];
    if (!summaries.length) throw Error("A análise não retornou a medição de loudness.");
    const data = JSON.parse(summaries.at(-1));
    const integrated = data.input_i === "-inf" ? -Infinity : Number(data.input_i), truePeak = Number(data.input_tp);
    if (integrated === -Infinity) return { version: ANALYSIS_VERSION, status: "silent" };
    if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) throw Error("Medição de loudness inválida.");
    return { version: ANALYSIS_VERSION, status: "measured", integrated, truePeak, range: Number(data.input_lra) || 0 };
}

// Filtering precedes the existing video-clocked PCM release. No second playback
// decoder, wall clock, or sample deletion/insertion is introduced by this feature.
function buildAudioLevelFilter({ enabled = true, loudness, sampleRate = 48000, channels = 2 } = {}) {
    const base = "aresample=async=1:first_pts=0";
    if (!enabled) return base;
    if (channels === 1) loudness = loudness?.mono || (loudness?.status === 'no-audio' ? loudness : undefined);
    let level;
    if (loudness?.status === "measured" && Number.isFinite(loudness.integrated)) {
        // Do not amplify near-silence/noise or apply unbounded gain to damaged metadata.
        const gain = loudness.integrated < -60 ? 0 : Math.max(-36, Math.min(18, TARGET_LUFS - loudness.integrated));
        level = `volume=${gain.toFixed(4)}dB`;
    } else if (loudness?.status === "silent" || loudness?.status === "no-audio") {
        level = "volume=1";
    } else {
        // Live or not-yet-measured source: conservative stereo-linked compression.
        // This controls dynamics; it does not promise a fixed integrated live LUFS.
        level = "acompressor=threshold=0.089125:ratio=3:attack=20:release=250:makeup=2:link=maximum:detection=rms";
    }
    const rate = [44100, 48000, 96000].includes(sampleRate) ? sampleRate : 48000;
    return `${base},aformat=channel_layouts=${channels === 1 ? "mono" : "stereo"},${level},aresample=192000,alimiter=limit=0.841395:attack=5:release=80:level=false:latency=true,aresample=${rate}`;
}

module.exports = { TARGET_LUFS, ANALYSIS_VERSION, parseLoudness, buildAudioLevelFilter };
