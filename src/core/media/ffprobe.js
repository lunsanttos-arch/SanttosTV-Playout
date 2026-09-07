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
                        20 * 1024 * 1024
                },
                (
                    error,
                    stdout,
                    stderr
                ) => {
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

    const videoStreams = streams.filter(
        (stream) =>
            stream.codec_type === "video" &&
            stream.disposition?.attached_pic !== 1
    );

    const audioStreams = streams.filter(
        (stream) =>
            stream.codec_type === "audio"
    );

    const videoStream = videoStreams[0];
    const audioStream = audioStreams[0];

    if (!videoStream) {
        throw new Error(
            "O arquivo não possui uma faixa de vídeo reproduzível."
        );
    }

    const fps = parseFrameRate(
        videoStream.avg_frame_rate ||
        videoStream.r_frame_rate
    );

    const duration = parseNumber(
        format.duration ??
        videoStream.duration
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
                : Number(
                    fps.toFixed(3)
                ),
        videoCodec:
            normalizeCodec(
                videoStream.codec_name
            ),
        videoProfile:
            videoStream.profile ?? null,
        pixelFormat:
            videoStream.pix_fmt ?? null,
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
        bitRate:
            parseInteger(
                format.bit_rate ??
                videoStream.bit_rate
            ),
        container:
            normalizeContainer(
                format.format_name
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
            "O FPS da origem não pôde ser determinado com precisão; o engine usará timestamps do arquivo e normalização do PROGRAM."
        );
    }

    if (
        metadata.videoCodec &&
        ![
            "H.264",
            "H.265",
            "VP9",
            "AV1",
            "MPEG2VIDEO",
            "PRORES",
            "DNXHD",
            "MJPEG",
            "VC1",
            "WMV3",
            "MPEG4"
        ].includes(metadata.videoCodec)
    ) {
        warnings.push(
            `Codec ${metadata.videoCodec} será reproduzido por fallback de software se o FFmpeg oferecer decoder.`
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

    const [
        numerator,
        denominator
    ] = value
        .split("/")
        .map(Number);

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
        vp9: "VP9",
        prores: "PRORES",
        dnxhd: "DNXHD",
        mjpeg: "MJPEG",
        mpeg2video: "MPEG2VIDEO",
        mpeg4: "MPEG4",
        vc1: "VC1",
        wmv3: "WMV3",
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
    probeMedia
};
