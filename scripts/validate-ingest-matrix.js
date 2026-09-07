const path = require("node:path");

const {
    probeMedia
} = require(
    "../src/core/media/ffprobe"
);

const {
    checkMediaDecode
} = require(
    "../src/core/media/decode-check"
);

const mediaDir =
    process.env.SANTTOS_MEDIA_DIR;

if (!mediaDir) {
    throw new Error(
        "SANTTOS_MEDIA_DIR não foi definido."
    );
}

const files = [
    "h264.mp4",
    "ffv1.mkv",
    "prores.mov",
    "mpeg2.ts",
    "mpeg4.avi",
    "multiaudio.mp4"
];

async function main() {
    for (const name of files) {
        const file = path.join(
            mediaDir,
            name
        );

        const metadata =
            await probeMedia(file);
        const decode =
            await checkMediaDecode(
                file,
                metadata.videoStreamIndex
            );

        if (!decode.decodable) {
            throw new Error(
                `${name}: decoder preflight falhou.`
            );
        }

        if (
            metadata.status ===
            "incompatible"
        ) {
            throw new Error(
                `${name}: analisador marcou a mídia como incompatível.`
            );
        }

        console.log(
            [
                "[matrix]",
                name,
                metadata.container,
                metadata.videoCodec,
                `${metadata.width}x${metadata.height}`,
                `${metadata.fps}fps`,
                `decoder=${decode.preferredMode}`
            ].join(" | ")
        );
    }

    const multi =
        await probeMedia(
            path.join(
                mediaDir,
                "multiaudio.mp4"
            )
        );

    if (multi.audioStreamCount !== 2) {
        throw new Error(
            `Esperadas 2 faixas de áudio; recebidas ${multi.audioStreamCount}.`
        );
    }

    if (
        multi.audioStreamOrdinal !== 0 ||
        multi.primaryAudioTrack !== 0
    ) {
        throw new Error(
            "Áudio 01 não foi selecionado como principal."
        );
    }

    if (
        multi.audioTracks?.[0]
            ?.channelLabel !== "Áudio 01"
    ) {
        throw new Error(
            "Metadados do Áudio 01 estão incorretos."
        );
    }

    if (
        multi.audioTracks?.[1]
            ?.default !== true
    ) {
        throw new Error(
            "Fixture inválida: Áudio 02 deveria estar marcado como default."
        );
    }

    if (
        multi.audioTracks?.[0]
            ?.role !== "program"
    ) {
        throw new Error(
            "Áudio 01 precisa ter role=program."
        );
    }

    console.log(
        "[matrix] PRIORIDADE ÁUDIO 01 VALIDADA: Áudio 01 permaneceu principal mesmo com Áudio 02 marcado como default."
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
