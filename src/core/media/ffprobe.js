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

    const videoStream =
        streams.find(
            (stream) =>
                stream.codec_type ===
                "video"
        );

    const audioStream =
        streams.find(
            (stream) =>
                stream.codec_type ===
                "audio"
        );

    if (!videoStream) {
        throw new Error(
            "O arquivo não possui uma faixa de vídeo."
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

        width:
            parseInteger(
                videoStream.width
            ),

        height:
            parseInteger(
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
            videoStream.profile ??
            null,

        pixelFormat:
            videoStream.pix_fmt ??
            null,

        audioCodec:
            normalizeCodec(
                audioStream?.codec_name
            ),

        audioChannels:
            parseInteger(
                audioStream?.channels
            ),

        audioLayout:
            audioStream
                ?.channel_layout ??
            null,

        sampleRate:
            parseInteger(
                audioStream
                    ?.sample_rate
            ),

        bitRate:
            parseInteger(
                format.bit_rate ??
                videoStream.bit_rate
            ),

        metadataError: null
    };

    const validation =
        validateMedia(metadata);

    return {
        ...metadata,

        status:
            validation.status,

        compatibility:
            validation
    };
}

function validateMedia(metadata) {
    const issues = [];

    const isFullHdCompatible =
        metadata.width === 1920 &&
        metadata.height !== null &&
        metadata.height > 0 &&
        metadata.height <= 1080;

    if (!isFullHdCompatible) {
        issues.push(
            "A resolução precisa ter 1920 pixels de largura e altura de até 1080."
        );
    }

    if (metadata.videoCodec !== "H.264") {
        issues.push(
            "O codec de vídeo não é H.264."
        );
    }

    if (
        metadata.fps === null ||
        !isSupportedFrameRate(metadata.fps)
    ) {
        issues.push(
            "O FPS não é compatível."
        );
    }

    return {
        status:
            issues.length === 0
                ? "compatible"
                : "incompatible",

        issues
    };
}
function isSupportedFrameRate(fps) {
    const supportedRates = [
        24000 / 1001,
        23.98,
        24,
        60000 / 1001,
        60
    ];

    return supportedRates.some(
        (supportedRate) =>
            Math.abs(
                fps - supportedRate
            ) < 0.03
    );
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
        aac: "AAC",
        pcm_s16le: "PCM",
        pcm_s24le: "PCM 24-bit",
        mp3: "MP3",
        ac3: "AC-3"
    };

    return (
        codecNames[normalized] ??
        normalized.toUpperCase()
    );
}

module.exports = {
    probeMedia
};
