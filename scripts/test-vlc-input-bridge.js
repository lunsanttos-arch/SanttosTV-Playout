"use strict";

const assert = require("node:assert/strict");
const {
    candidateVlcPaths,
    findVlcPath,
    selectInputEngine,
    vlcSout,
    buildVlcArgs,
    udpInputUrl
} = require("../src/core/playout/vlc-input-bridge");

const candidates =
    candidateVlcPaths({
        ProgramFiles:
            "C:\\Program Files",
        "ProgramFiles(x86)":
            "C:\\Program Files (x86)",
        LOCALAPPDATA:
            "C:\\Users\\qa\\AppData\\Local",
        SANTTOS_VLC_PATH:
            "D:\\Portable\\VLC\\vlc.exe"
    });

assert.equal(
    candidates[0],
    "D:\\Portable\\VLC\\vlc.exe"
);
assert(
    candidates.some(
        value =>
            /VideoLAN[\\/]VLC[\\/]vlc\.exe$/i.test(
                value
            )
    )
);

const found =
    findVlcPath({
        env: {
            SANTTOS_VLC_PATH:
                "D:\\VLC\\vlc.exe"
        },
        existsSync:
            value =>
                value ===
                "D:\\VLC\\vlc.exe",
        spawnSyncImpl:
            () => ({
                status: 1,
                stdout: ""
            })
    });

assert.equal(
    found,
    "D:\\VLC\\vlc.exe"
);

assert.equal(
    selectInputEngine(
        "auto",
        "dailymotion",
        true
    ),
    "vlc"
);

assert.equal(
    selectInputEngine(
        "auto",
        "direct",
        true
    ),
    "ffmpeg"
);

assert.equal(
    selectInputEngine(
        "vlc",
        "direct",
        true
    ),
    "vlc"
);

assert.throws(
    () =>
        selectInputEngine(
            "vlc",
            "direct",
            false
        ),
    /VLC não foi encontrado/
);

const sout =
    vlcSout(
        32001,
        32002
    );

assert.match(
    sout,
    /access=udp/
);
assert.match(
    sout,
    /mux=ts/
);
assert.match(
    sout,
    /127\.0\.0\.1:32001/
);
assert.match(
    sout,
    /127\.0\.0\.1:32002/
);

const args =
    buildVlcArgs(
        "https://example.com/live.m3u8",
        {
            videoPort: 32001,
            audioPort: 32002,
            userAgent:
                "Santtos QA Browser",
            referer:
                "https://example.com/player"
        }
    );

assert(
    args.includes(
        "--intf=dummy"
    )
);
assert(
    args.includes(
        "--http-user-agent=Santtos QA Browser"
    )
);
assert(
    args.includes(
        "--http-referrer=https://example.com/player"
    )
);
assert(
    args.some(
        value =>
            value.startsWith(
                "--sout=#duplicate{"
            )
    )
);

const resumedArgs =
    buildVlcArgs(
        "https://example.com/vod.m3u8",
        {
            videoPort: 32011,
            audioPort: 32012,
            startTimeSeconds:
                17.25
        }
    );

assert(
    resumedArgs.includes(
        "--start-time=17.250"
    ),
    "PAUSE -> PLAY de Input Web via VLC deve reabrir a fonte no timecode salvo."
);

assert.equal(
    udpInputUrl(32001),
    "udp://127.0.0.1:32001?overrun_nonfatal=1&fifo_size=5000000"
);

console.log(
    "VLC INPUT BRIDGE QA: APROVADO — detecção, seleção de motor e bridge UDP/MPEG-TS."
);
