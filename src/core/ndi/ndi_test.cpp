#define NOMINMAX
#include <Processing.NDI.Lib.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include <windows.h>
#include <fcntl.h>
#include <io.h>

namespace {
bool isAllowedPipe(const std::string& value) {
    const std::string prefix = R"(\\.\pipe\SanttosAudio-)";
    if (value.rfind(prefix, 0) != 0 || value.size() > 150 ||
        value.size() <= prefix.size()) return false;
    for (std::size_t i = prefix.size(); i < value.size(); ++i) {
        const char c = value[i];
        if (!((c >= '0' && c <= '9') ||
              (c >= 'a' && c <= 'f') || c == '-')) return false;
    }
    return true;
}

bool isAllowedName(const std::string& value) {
    if (value.empty() || value.size() > 120) return false;
    for (unsigned char c : value) {
        if (c < 32 || c == 127) return false;
    }
    return true;
}

bool parsePositiveInt(const char* raw, int minimum, int maximum, int& value) {
    if (!raw || !*raw) return false;
    try {
        std::size_t consumed = 0;
        const long parsed = std::stol(raw, &consumed, 10);
        if (consumed != std::strlen(raw) ||
            parsed < minimum || parsed > maximum) return false;
        value = static_cast<int>(parsed);
        return true;
    } catch (...) {
        return false;
    }
}

bool parseAspect(const char* raw, float& value) {
    if (!raw || !*raw) return false;
    try {
        std::size_t consumed = 0;
        const float parsed = std::stof(raw, &consumed);
        if (consumed != std::strlen(raw) || parsed < 0.5f || parsed > 4.0f) {
            return false;
        }
        value = parsed;
        return true;
    } catch (...) {
        return false;
    }
}

bool readExactly(HANDLE pipe, unsigned char* buffer, DWORD bytes) {
    DWORD readTotal = 0;
    while (readTotal < bytes) {
        DWORD got = 0;
        if (!ReadFile(pipe, buffer + readTotal,
                      bytes - readTotal, &got, nullptr) || got == 0) {
            return false;
        }
        readTotal += got;
    }
    return true;
}

void receiveAudio(
    HANDLE pipe,
    NDIlib_send_instance_t sender,
    std::atomic<bool>& running,
    int audioRate,
    int audioChannels
) {
    const int audioSamplesPerPacket = (std::max)(1, audioRate / 50); // 20 ms
    const DWORD bytesPerPacket =
        static_cast<DWORD>(
            audioSamplesPerPacket * audioChannels * sizeof(float)
        );

    std::vector<unsigned char> packed(bytesPerPacket);
    std::vector<float> planar(
        static_cast<std::size_t>(audioSamplesPerPacket) * audioChannels
    );

    NDIlib_audio_frame_v3_t audio = {};
    audio.sample_rate = audioRate;
    audio.no_channels = audioChannels;
    audio.no_samples = audioSamplesPerPacket;
    audio.timecode = NDIlib_send_timecode_synthesize;
    audio.FourCC = NDIlib_FourCC_audio_type_FLTP;
    audio.channel_stride_in_bytes =
        audioSamplesPerPacket * sizeof(float);
    audio.p_data = reinterpret_cast<uint8_t*>(planar.data());
    audio.p_metadata = nullptr;

    bool announcedAudio = false;

    while (running.load()) {
        // One FFmpeg audio stream connects for every PLAY or seek. A new
        // connection is accepted after the previous clip's EOF.
        const BOOL accepted = ConnectNamedPipe(pipe, nullptr);
        if (!accepted && GetLastError() != ERROR_PIPE_CONNECTED) {
            if (!running.load()) break;
            DisconnectNamedPipe(pipe);
            continue;
        }

        while (running.load() &&
               readExactly(pipe, packed.data(), bytesPerPacket)) {
            // FFmpeg produces interleaved f32le. NDI FLTP is planar.
            for (int sample = 0; sample < audioSamplesPerPacket; ++sample) {
                for (int channel = 0; channel < audioChannels; ++channel) {
                    const std::size_t packedOffset =
                        static_cast<std::size_t>(
                            sample * audioChannels + channel
                        ) * sizeof(float);
                    const std::size_t planarIndex =
                        static_cast<std::size_t>(channel) *
                        audioSamplesPerPacket + sample;
                    std::memcpy(
                        &planar[planarIndex],
                        packed.data() + packedOffset,
                        sizeof(float)
                    );
                }
            }

            NDIlib_send_send_audio_v3(sender, &audio);

            if (!announcedAudio) {
                announcedAudio = true;
                std::cout
                    << "NDI AUDIO ACTIVE: FLTP "
                    << audioRate << "Hz "
                    << audioChannels << "ch"
                    << std::endl;
            }
        }

        DisconnectNamedPipe(pipe);
    }
}

std::size_t frameSizeFor(
    int width,
    int height,
    const std::string& pixelFormat
) {
    const std::size_t pixels =
        static_cast<std::size_t>(width) *
        static_cast<std::size_t>(height);

    if (pixelFormat == "i420") return pixels * 3 / 2;
    if (pixelFormat == "uyvy") return pixels * 2;
    return pixels * 4;
}

void fillBlack(
    std::vector<std::uint8_t>& frame,
    int width,
    int height,
    const std::string& pixelFormat
) {
    if (pixelFormat == "i420") {
        const std::size_t yBytes =
            static_cast<std::size_t>(width) * height;
        std::fill(frame.begin(), frame.begin() + yBytes, 16);
        std::fill(frame.begin() + yBytes, frame.end(), 128);
        return;
    }

    if (pixelFormat == "uyvy") {
        for (std::size_t offset = 0; offset + 3 < frame.size(); offset += 4) {
            frame[offset] = 128;     // U
            frame[offset + 1] = 16;  // Y
            frame[offset + 2] = 128; // V
            frame[offset + 3] = 16;  // Y
        }
        return;
    }

    std::fill(frame.begin(), frame.end(), 0);
    for (std::size_t offset = 3; offset < frame.size(); offset += 4) {
        frame[offset] = 255;
    }
}
} // namespace

int main(int argc, char** argv) {
    std::string sourceName = "Santtos TV - PROGRAM";
    std::string audioPipe;
    std::string scanMode = "progressive";
    std::string pixelFormat = "bgra";
    int width = 1920;
    int height = 1080;
    int fpsN = 30000;
    int fpsD = 1001;
    int audioRate = 48000;
    int audioChannels = 2;
    float pictureAspect = 16.0f / 9.0f;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];

        if (arg == "--capabilities") {
            std::cout
                << "SANTTOS_NDI_CAPS: AUDIO_PIPE_V1 NAME_ARGUMENT_V1 "
                   "AUDIO_FLTP_V3 DYNAMIC_PROFILE_V1"
                << std::endl;
            return 0; // Must never create a sender in a capability probe.
        }

        if (arg == "--name" && i + 1 < argc) {
            sourceName = argv[++i];
        } else if (arg == "--audio-pipe" && i + 1 < argc) {
            audioPipe = argv[++i];
        } else if (arg == "--width" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 320, 4096, width)) return 2;
        } else if (arg == "--height" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 240, 2160, height)) return 2;
        } else if (arg == "--fps-n" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 1, 120000, fpsN)) return 2;
        } else if (arg == "--fps-d" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 1, 1001, fpsD)) return 2;
        } else if (arg == "--scan" && i + 1 < argc) {
            scanMode = argv[++i];
        } else if (arg == "--aspect" && i + 1 < argc) {
            if (!parseAspect(argv[++i], pictureAspect)) return 2;
        } else if (arg == "--pixel-format" && i + 1 < argc) {
            pixelFormat = argv[++i];
        } else if (arg == "--audio-rate" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 8000, 192000, audioRate)) return 2;
        } else if (arg == "--audio-channels" && i + 1 < argc) {
            if (!parsePositiveInt(argv[++i], 1, 2, audioChannels)) return 2;
        } else {
            std::cerr << "Argumento NDI invalido." << std::endl;
            return 2;
        }
    }

    if (!isAllowedName(sourceName)) {
        std::cerr << "Nome NDI invalido." << std::endl;
        return 2;
    }
    if (!audioPipe.empty() && !isAllowedPipe(audioPipe)) {
        std::cerr << "Caminho de pipe de audio invalido." << std::endl;
        return 2;
    }
    if ((width % 2) != 0 || (height % 2) != 0) {
        std::cerr << "Resolucao NDI deve usar dimensoes pares." << std::endl;
        return 2;
    }
    if (scanMode != "progressive" && scanMode != "interlaced") {
        std::cerr << "Modo de varredura NDI invalido." << std::endl;
        return 2;
    }
    if (pixelFormat != "bgra" &&
        pixelFormat != "uyvy" &&
        pixelFormat != "i420") {
        std::cerr << "Pixel format NDI invalido." << std::endl;
        return 2;
    }

    if (!NDIlib_initialize()) {
        std::cerr << "ERRO: NDI nao pode ser inicializado." << std::endl;
        return 1;
    }

    NDIlib_send_create_t settings = {};
    settings.p_ndi_name = sourceName.c_str();
    settings.p_groups = nullptr;
    settings.clock_video = true;
    settings.clock_audio = !audioPipe.empty();

    NDIlib_send_instance_t sender = NDIlib_send_create(&settings);
    if (!sender) {
        std::cerr << "ERRO: nao foi possivel criar o sender NDI." << std::endl;
        NDIlib_destroy();
        return 1;
    }

    HANDLE audioHandle = INVALID_HANDLE_VALUE;
    std::atomic<bool> audioRunning{true};
    std::thread audioThread;

    if (!audioPipe.empty()) {
        audioHandle = CreateNamedPipeA(
            audioPipe.c_str(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            65536,
            65536,
            0,
            nullptr
        );

        if (audioHandle == INVALID_HANDLE_VALUE) {
            std::cerr << "ERRO: nao foi possivel criar pipe de audio."
                      << std::endl;
            NDIlib_send_destroy(sender);
            NDIlib_destroy();
            return 1;
        }

        audioThread = std::thread([&]() {
            receiveAudio(
                audioHandle,
                sender,
                audioRunning,
                audioRate,
                audioChannels
            );
        });

        std::cout << "NDI AUDIO PIPE READY:" << audioPipe << std::endl;
    }

    _setmode(_fileno(stdin), _O_BINARY);

    const std::size_t frameSize =
        frameSizeFor(width, height, pixelFormat);
    std::vector<std::uint8_t> frame(frameSize, 0);
    fillBlack(frame, width, height, pixelFormat);

    NDIlib_video_frame_v2_t video = {};
    video.xres = width;
    video.yres = height;

    if (pixelFormat == "i420") {
        video.FourCC = NDIlib_FourCC_type_I420;
        video.line_stride_in_bytes = width;
    } else if (pixelFormat == "uyvy") {
        video.FourCC = NDIlib_FourCC_type_UYVY;
        video.line_stride_in_bytes = width * 2;
    } else {
        video.FourCC = NDIlib_FourCC_type_BGRA;
        video.line_stride_in_bytes = width * 4;
    }

    video.frame_rate_N = fpsN;
    video.frame_rate_D = fpsD;
    video.picture_aspect_ratio = pictureAspect;
    video.frame_format_type =
        scanMode == "interlaced"
            ? NDIlib_frame_format_type_interleaved
            : NDIlib_frame_format_type_progressive;
    video.timecode = NDIlib_send_timecode_synthesize;
    video.p_data = frame.data();

    std::cout << "NDI ONLINE: " << sourceName << std::endl;
    std::cout
        << "NDI VIDEO PROFILE: "
        << width << "x" << height << " "
        << fpsN << "/" << fpsD << " "
        << scanMode << " "
        << pixelFormat << " DAR=" << pictureAspect
        << std::endl;

    if (!audioPipe.empty()) {
        std::cout
            << "NDI AUDIO: FLTP v3 "
            << audioRate << "Hz "
            << audioChannels << "ch"
            << std::endl;
    }

    NDIlib_send_send_video_v2(sender, &video); // black until PLAY

    while (std::cin.read(
        reinterpret_cast<char*>(frame.data()),
        static_cast<std::streamsize>(frameSize)
    )) {
        video.p_data = frame.data();
        NDIlib_send_send_video_v2(sender, &video);
    }

    if (audioThread.joinable()) {
        audioRunning.store(false);

        // Wake a thread that is blocked in ConnectNamedPipe.
        HANDLE wake = CreateFileA(
            audioPipe.c_str(),
            GENERIC_WRITE,
            0,
            nullptr,
            OPEN_EXISTING,
            0,
            nullptr
        );
        if (wake != INVALID_HANDLE_VALUE) CloseHandle(wake);

        audioThread.join();
    }

    if (audioHandle != INVALID_HANDLE_VALUE) {
        CloseHandle(audioHandle);
    }

    NDIlib_send_destroy(sender);
    NDIlib_destroy();
    return 0;
}
