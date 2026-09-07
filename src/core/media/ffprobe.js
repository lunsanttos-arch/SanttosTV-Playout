const {
    execFile
} = require("node:child_process");

const ffprobeModule = require(
    "@derhuerst/ffprobe-static"
);

const ffprobePath =
    typeof ffprobeModule === "string"
        ? ffprobeModule
        : ffprobeModule.path ??
          ffprobeModule.default;

if (!ffprobePath) {
    throw new Error(
        "O executável do FFprobe não foi encontrado."
    );
}

function probeMedia(filePath) {
    return new Promise(
        (resolve, reject) => {
            const argumentsList = [
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                filePath
            ];

            execFile(
                ffprobePath,
                argumentsList,
                {
                    windowsHide: true,
                    maxBuffer:
                        32 * 1024 * 1024
                },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(
                            new Error(
                                stderr?.trim() ||
                                error.message
                            )
                        );
                        return;
                    }

                    try {
                        const probeResult =
                            JSON.parse(stdout);

                        resolve(
                            parseProbeResult(
                                probeResult
                            )
                        );
                    } catch (parseError) {
                        reject(
                            new Error(
                                `Resposta inválida do FFprobe: ${parseError.message}`
                            )
                        );
                    }
                }
            );
        }
    );
}

function parseProbeResult(probeResult) {
    const streams =
        Array.isArray(probeResult.streams)
            ? probeResult.streams
            : [];

    const format =
        probeResult.format ?? {};

    const allVideoStreams = streams.filter(
        (stream) =>
            stream.codec_type === "video"
    );

    const videoStreams = allVideoStreams.filter(
        (stream) =>
            stream.disposition?.attached_pic !== 1
    );

    const audioStreams = streams.filter(
        (stream) =>
            stream.codec_type === "audio"
    );

    const videoStream =
        chooseBestVideoStream(videoStreams);
    const audioStream =
        chooseBestAudioStream(audioStreams);

    if (!videoStream) {
        throw new Error(
            "O arquivo não possui uma faixa de vídeo reproduzível."
        );
    }

    const averageFps = parseFrameRate(
        videoStream.avg_frame_rate
    );
    const nominalFps = parseFrameRate(
        videoStream.r_frame_rate
    );
    const fps =
        averageFps ?? nominalFps;

    const duration = parseNumber(
        format.duration ??
        videoStream.duration
    );

    const rotation = getRotation(videoStream);
    const sampleAspectRatio =
        normalizeRatio(
            videoStream.sample_aspect_ratio
        );
    const displayAspectRatio =
        normalizeRatio(
            videoStream.display_aspect_ratio
        );
    const timingMode = detectTimingMode(
        averageFps,
        nominalFps
    );

    const metadata = {
        duration,
        width: parseInteger(
            videoStream.width
        ),
        height: parseInteger(
            videoStream.height
        ),
        fps:
            fps === null
                ? null
                : Number(fps.toFixed(3)),
        averageFps:
            averageFps === null
                ? null
                : Number(
                    averageFps.toFixed(3)
                ),
        nominalFps:
            nominalFps === null
                ? null
                : Number(
                    nominalFps.toFixed(3)
                ),
        timingMode,
        isVariableFrameRate:
            timingMode === "vfr",
        videoCodec:
            normalizeCodec(
                videoStream.codec_name
            ),
        videoProfile:
            videoStream.profile ?? null,
        videoLevel:
            parseInteger(videoStream.level),
        pixelFormat:
            videoStream.pix_fmt ?? null,
        bitDepth:
            parseInteger(
                videoStream.bits_per_raw_sample ??
                videoStream.bits_per_sample
            ),
        colorRange:
            videoStream.color_range ?? null,
        colorSpace:
            videoStream.color_space ?? null,
        colorTransfer:
            videoStream.color_transfer ?? null,
        colorPrimaries:
            videoStream.color_primaries ?? null,
        sampleAspectRatio,
        displayAspectRatio,
        rotation,
        videoStreamIndex:
            parseInteger(videoStream.index),
        videoStreamOrdinal:
            getStreamOrdinal(
                allVideoStreams,
                videoStream
            ),
        audioCodec:
            normalizeCodec(
                audioStream?.codec_name
            ),
        audioChannels:
            parseInteger(
                audioStream?.channels
            ),
        audioLayout:
            audioStream?.channel_layout ??
            null,
        sampleRate:
            parseInteger(
                audioStream?.sample_rate
            ),
        audioStreamIndex:
            parseInteger(audioStream?.index),
        audioStreamOrdinal:
            getStreamOrdinal(
                audioStreams,
                audioStream
            ),
        bitRate:
            parseInteger(
                format.bit_rate ??
                videoStream.bit_rate
            ),
        container:
            normalizeContainer(
                format.format_name
            ),
        formatLongName:
            format.format_long_name ?? null,
        startTime:
            parseNumber(
                format.start_time ??
                videoStream.start_time
            ),
        videoStreamCount:
            videoStreams.length,
        audioStreamCount:
            audioStreams.length,
        metadataError: null
    };

    const validation =
        validateMedia(metadata);

    return {
        ...metadata,
        status: validation.status,
        compatibility: validation
    };
}

function chooseBestVideoStream(streams) {
    if (!Array.isArray(streams) || streams.length === 0) {
        return null;
    }

    return [...streams].sort(
        (left, right) =>
            scoreVideoStream(right) -
            scoreVideoStream(left)
    )[0] ?? null;
}

function scoreVideoStream(stream) {
    const width =
        parseInteger(stream.width) ?? 0;
    const height =
        parseInteger(stream.height) ?? 0;
    const pixels = width * height;

    let score = Math.min(
        pixels,
        100000000
    );

    if (stream.disposition?.default === 1) {
        score += 200000000;
    }

    if (stream.disposition?.forced === 1) {
        score += 1000000;
    }

    if (stream.disposition?.attached_pic === 1) {
        score -= 1000000000;
    }

    if (width <= 0 || height <= 0) {
        score -= 500000000;
    }

    return score;
}

function chooseBestAudioStream(streams) {
    if (!Array.isArray(streams) || streams.length === 0) {
        return null;
    }

    return [...streams].sort(
        (left, right) =>
            scoreAudioStream(right) -
            scoreAudioStream(left)
    )[0] ?? null;
}

function scoreAudioStream(stream) {
    const channels =
        parseInteger(stream.channels) ?? 0;
    const sampleRate =
        parseInteger(stream.sample_rate) ?? 0;

    let score =
        channels * 100000 +
        sampleRate;

    if (stream.disposition?.default === 1) {
        score += 10000000;
    }

    if (stream.disposition?.forced === 1) {
        score += 100000;
    }

    return score;
}

function getStreamOrdinal(streams, selected) {
    if (!selected || !Array.isArray(streams)) {
        return null;
    }

    const index = streams.findIndex(
        (stream) =>
            stream === selected ||
            stream.index === selected.index
    );

    return index >= 0
        ? index
        : null;
}

function getRotation(stream) {
    const sideData =
        Array.isArray(stream.side_data_list)
            ? stream.side_data_list
            : [];

    const displayMatrix = sideData.find(
        (item) =>
            Number.isFinite(
                Number(item.rotation)
            )
    );

    const raw =
        displayMatrix?.rotation ??
        stream.tags?.rotate;

    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {
        return 0;
    }

    const normalized =
        ((Math.round(parsed) % 360) + 360) % 360;

    return normalized;
}

function detectTimingMode(
    averageFps,
    nominalFps
) {
    if (
        averageFps === null ||
        nominalFps === null
    ) {
        return "unknown";
    }

    const difference = Math.abs(
        averageFps - nominalFps
    );

    const tolerance = Math.max(
        0.02,
        nominalFps * 0.002
    );

    return difference > tolerance
        ? "vfr"
        : "cfr";
}

function validateMedia(metadata) {
    const warnings = [];

    if (
        metadata.width === null ||
        metadata.height === null ||
        metadata.width <= 0 ||
        metadata.height <= 0
    ) {
        return {
            status: "incompatible",
            issues: [
                "A faixa de vídeo não possui dimensões válidas."
            ],
            warnings
        };
    }

    if (
        metadata.width !== 1920 ||
        metadata.height !== 1080
    ) {
        warnings.push(
            `A origem é ${metadata.width}x${metadata.height}; o PROGRAM normalizará para o formato de saída.`
        );
    }

    if (
        metadata.fps === null ||
        metadata.fps <= 0
    ) {
        warnings.push(
            "O FPS da origem não pôde ser determinado com precisão; o engine usará timestamps e normalização do PROGRAM."
        );
    }

    if (metadata.isVariableFrameRate) {
        warnings.push(
            "A origem usa frame rate variável (VFR); o engine fará normalização temporal para o PROGRAM."
        );
    }

    if (metadata.rotation !== 0) {
        warnings.push(
            `A origem possui rotação de ${metadata.rotation}°; o FFmpeg aplicará a orientação antes da normalização.`
        );
    }

    if (
        metadata.sampleAspectRatio &&
        metadata.sampleAspectRatio !== "1:1"
    ) {
        warnings.push(
            `A origem usa SAR ${metadata.sampleAspectRatio}; o PROGRAM converterá para pixels quadrados.`
        );
    }

    if (
        metadata.videoStreamCount > 1
    ) {
        warnings.push(
            `O arquivo possui ${metadata.videoStreamCount} faixas de vídeo; a faixa ${metadata.videoStreamIndex} foi escolhida automaticamente.`
        );
    }

    if (
        metadata.audioStreamCount > 1
    ) {
        warnings.push(
            `O arquivo possui ${metadata.audioStreamCount} faixas de áudio; a faixa ${metadata.audioStreamIndex} foi escolhida automaticamente.`
        );
    }

    return {
        status: "compatible",
        issues: [],
        warnings
    };
}

function parseFrameRate(value) {
    if (
        typeof value !== "string" ||
        value === "0/0"
    ) {
        return null;
    }

    if (!value.includes("/")) {
        return parseNumber(value);
    }

    const [numerator, denominator] =
        value.split("/").map(Number);

    if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        denominator === 0
    ) {
        return null;
    }

    return numerator / denominator;
}

function parseNumber(value) {
    const parsed = Number(value);

    return Number.isFinite(parsed)
        ? parsed
        : null;
}

function parseInteger(value) {
    const parsed =
        Number.parseInt(
            String(value),
            10
        );

    return Number.isFinite(parsed)
        ? parsed
        : null;
}

function normalizeRatio(value) {
    if (
        typeof value !== "string" ||
        value === "0:1" ||
        value === "N/A"
    ) {
        return null;
    }

    return value;
}

function normalizeContainer(formatName) {
    if (!formatName) {
        return null;
    }

    const names = String(formatName)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return names[0] ?? null;
}

function normalizeCodec(codecName) {
    if (!codecName) {
        return null;
    }

    const normalized =
        String(codecName)
            .toLowerCase();

    const codecNames = {
        h264: "H.264",
        hevc: "H.265",
        av1: "AV1",
        vp8: "VP8",
        vp9: "VP9",
        prores: "PRORES",
        dnxhd: "DNXHD/DNXHR",
        mjpeg: "MJPEG",
        mpeg1video: "MPEG1VIDEO",
        mpeg2video: "MPEG2VIDEO",
        mpeg4: "MPEG4",
        vc1: "VC1",
        wmv3: "WMV3",
        theora: "THEORA",
        aac: "AAC",
        pcm_s16le: "PCM",
        pcm_s24le: "PCM 24-bit",
        pcm_s32le: "PCM 32-bit",
        flac: "FLAC",
        alac: "ALAC",
        mp3: "MP3",
        ac3: "AC-3",
        eac3: "E-AC-3",
        opus: "OPUS",
        vorbis: "VORBIS"
    };

    return (
        codecNames[normalized] ??
        normalized.toUpperCase()
    );
}

module.exports = {
    probeMedia,
    parseProbeResult,
    chooseBestVideoStream,
    chooseBestAudioStream
};
