const {
    execFile
} = require("node:child_process");
const ffmpegStatic = require("ffmpeg-static");

if (!ffmpegStatic) {
    throw new Error(
        "FFmpeg runtime não encontrado para validação de decode."
    );
}

function runDecodeProbe(
    filePath,
    videoStreamIndex,
    useHardware
) {
    return new Promise((resolve) => {
        const inputSelector =
            Number.isInteger(Number(videoStreamIndex))
                ? `0:${Number(videoStreamIndex)}`
                : "0:v:0";

        const args = [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-fflags",
            "+genpts+discardcorrupt",
            "-err_detect",
            "ignore_err",
            "-probesize",
            "10000000",
            "-analyzeduration",
            "10000000"
        ];

        if (useHardware) {
            args.push(
                "-hwaccel",
                "auto"
            );
        }

        args.push(
            "-i",
            filePath,
            "-map",
            inputSelector,
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-f",
            "null",
            "-"
        );

        execFile(
            ffmpegStatic,
            args,
            {
                windowsHide: true,
                timeout: 20000,
                maxBuffer:
                    4 * 1024 * 1024
            },
            (error, _stdout, stderr) => {
                resolve({
                    ok: !error,
                    error:
                        error
                            ? (
                                  stderr?.trim() ||
                                  error.message
                              )
                            : null
                });
            }
        );
    });
}

async function checkMediaDecode(
    filePath,
    videoStreamIndex
) {
    const hardware =
        await runDecodeProbe(
            filePath,
            videoStreamIndex,
            true
        );

    if (hardware.ok) {
        return {
            decodable: true,
            preferredMode: "hardware",
            hardwareAvailable: true,
            hardwareError: null,
            softwareError: null
        };
    }

    const software =
        await runDecodeProbe(
            filePath,
            videoStreamIndex,
            false
        );

    if (software.ok) {
        return {
            decodable: true,
            preferredMode: "software",
            hardwareAvailable: false,
            hardwareError:
                hardware.error,
            softwareError: null
        };
    }

    return {
        decodable: false,
        preferredMode: "unavailable",
        hardwareAvailable: false,
        hardwareError:
            hardware.error,
        softwareError:
            software.error
    };
}

module.exports = {
    checkMediaDecode,
    runDecodeProbe
};
