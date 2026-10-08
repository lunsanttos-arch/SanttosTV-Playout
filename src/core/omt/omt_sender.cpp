#define NOMINMAX
#include <windows.h>
#include <fcntl.h>
#include <io.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr int OMTFrameType_Video = 2;
constexpr int OMTFrameType_Audio = 4;
constexpr int OMTCodec_FPA1 = 0x31415046;
constexpr int OMTCodec_UYVY = 0x59565955;
constexpr int OMTCodec_BGRA = 0x41524742;
constexpr int OMTQuality_Default = 0;
constexpr int OMTQuality_Low = 1;
constexpr int OMTQuality_Medium = 50;
constexpr int OMTQuality_High = 100;
constexpr int OMTColorSpace_BT709 = 709;
constexpr int OMTVideoFlags_None = 0;
constexpr int OMTVideoFlags_Interlaced = 1;

struct OMTMediaFrame {
    int Type;
    std::int64_t Timestamp;
    int Codec;
    int Width;
    int Height;
    int Stride;
    int Flags;
    int FrameRateN;
    int FrameRateD;
    float AspectRatio;
    int ColorSpace;
    int SampleRate;
    int Channels;
    int SamplesPerChannel;
    void* Data;
    int DataLength;
    void* CompressedData;
    int CompressedLength;
    void* FrameMetadata;
    int FrameMetadataLength;
};

struct OMTSenderInfo {
    char ProductName[1024];
    char Manufacturer[1024];
    char Version[1024];
    char Reserved1[1024];
    char Reserved2[1024];
    char Reserved3[1024];
};

using omt_send_t = long long;
using SendCreateFn = omt_send_t* (*)(const char*, int);
using SendDestroyFn = void (*)(omt_send_t*);
using SendFn = int (*)(omt_send_t*, OMTMediaFrame*);
using SendInfoFn = void (*)(omt_send_t*, OMTSenderInfo*);
using ShutdownFn = void (*)();

struct OmtApi {
    HMODULE module = nullptr;
    SendCreateFn create = nullptr;
    SendDestroyFn destroy = nullptr;
    SendFn send = nullptr;
    SendInfoFn setInfo = nullptr;
    ShutdownFn shutdown = nullptr;

    ~OmtApi() {
        if (module) FreeLibrary(module);
    }

    bool load() {
        module = LoadLibraryW(L"libomt.dll");
        if (!module) return false;

        create = reinterpret_cast<SendCreateFn>(
            GetProcAddress(module, "omt_send_create")
        );
        destroy = reinterpret_cast<SendDestroyFn>(
            GetProcAddress(module, "omt_send_destroy")
        );
        send = reinterpret_cast<SendFn>(
            GetProcAddress(module, "omt_send")
        );
        setInfo = reinterpret_cast<SendInfoFn>(
            GetProcAddress(module, "omt_send_setsenderinformation")
        );
        shutdown = reinterpret_cast<ShutdownFn>(
            GetProcAddress(module, "omt_shutdown")
        );

        return create && destroy && send;
    }
};

bool parsePositiveInt(
    const char* raw,
    int minimum,
    int maximum,
    int& value
) {
    if (!raw || !*raw) return false;
    try {
        std::size_t consumed = 0;
        const long parsed =
            std::stol(raw, &consumed, 10);

        if (
            consumed != std::strlen(raw) ||
            parsed < minimum ||
            parsed > maximum
        ) {
            return false;
        }

        value =
            static_cast<int>(parsed);
        return true;
    } catch (...) {
        return false;
    }
}

bool parseAspect(
    const char* raw,
    float& value
) {
    if (!raw || !*raw) return false;

    try {
        std::size_t consumed = 0;
        const float parsed =
            std::stof(raw, &consumed);

        if (
            consumed != std::strlen(raw) ||
            parsed < 0.5f ||
            parsed > 4.0f
        ) {
            return false;
        }

        value = parsed;
        return true;
    } catch (...) {
        return false;
    }
}

bool allowedName(
    const std::string& value
) {
    if (
        value.empty() ||
        value.size() > 120
    ) {
        return false;
    }

    for (unsigned char c : value) {
        if (c < 32 || c == 127) {
            return false;
        }
    }

    return true;
}

bool allowedPipe(
    const std::string& value
) {
    const std::string prefix =
        R"(\\.\pipe\SanttosOmtAudio-)";

    if (
        value.rfind(prefix, 0) != 0 ||
        value.size() <= prefix.size() ||
        value.size() > 160
    ) {
        return false;
    }

    for (
        std::size_t i = prefix.size();
        i < value.size();
        ++i
    ) {
        const char c = value[i];

        if (
            !(
                (c >= '0' && c <= '9') ||
                (c >= 'a' && c <= 'f') ||
                c == '-'
            )
        ) {
            return false;
        }
    }

    return true;
}

int qualityFromText(
    const std::string& value
) {
    if (value == "low") {
        return OMTQuality_Low;
    }

    if (value == "high") {
        return OMTQuality_High;
    }

    if (value == "default") {
        return OMTQuality_Default;
    }

    return OMTQuality_Medium;
}

std::size_t inputFrameSize(
    int width,
    int height,
    const std::string& pixelFormat
) {
    const std::size_t pixels =
        static_cast<std::size_t>(width) *
        static_cast<std::size_t>(height);

    if (pixelFormat == "i420") {
        return pixels * 3 / 2;
    }

    if (pixelFormat == "uyvy") {
        return pixels * 2;
    }

    return pixels * 4;
}

void i420ToUyvy(
    const std::uint8_t* input,
    std::uint8_t* output,
    int width,
    int height
) {
    const std::size_t yPlaneSize =
        static_cast<std::size_t>(width) *
        static_cast<std::size_t>(height);

    const std::size_t chromaPlaneSize =
        yPlaneSize / 4;

    const std::uint8_t* yPlane =
        input;

    const std::uint8_t* uPlane =
        input + yPlaneSize;

    const std::uint8_t* vPlane =
        uPlane + chromaPlaneSize;

    for (int y = 0; y < height; ++y) {
        const int chromaY =
            y / 2;

        for (
            int x = 0;
            x < width;
            x += 2
        ) {
            const std::size_t yIndex =
                static_cast<std::size_t>(y) *
                    width +
                x;

            const std::size_t chromaIndex =
                static_cast<std::size_t>(
                    chromaY
                ) *
                    (width / 2) +
                (x / 2);

            const std::size_t outIndex =
                yIndex * 2;

            output[outIndex] =
                uPlane[chromaIndex];

            output[outIndex + 1] =
                yPlane[yIndex];

            output[outIndex + 2] =
                vPlane[chromaIndex];

            output[outIndex + 3] =
                yPlane[yIndex + 1];
        }
    }
}

bool readExactly(
    HANDLE pipe,
    unsigned char* buffer,
    DWORD bytes
) {
    DWORD total = 0;

    while (total < bytes) {
        DWORD got = 0;

        if (
            !ReadFile(
                pipe,
                buffer + total,
                bytes - total,
                &got,
                nullptr
            ) ||
            got == 0
        ) {
            return false;
        }

        total += got;
    }

    return true;
}

void receiveAudio(
    HANDLE pipe,
    OmtApi& api,
    omt_send_t* sender,
    std::mutex& senderMutex,
    std::atomic<bool>& running,
    int sampleRate,
    int channels
) {
    const int samplesPerPacket =
        (std::max)(
            1,
            sampleRate / 50
        );

    const DWORD bytesPerPacket =
        static_cast<DWORD>(
            samplesPerPacket *
            channels *
            sizeof(float)
        );

    std::vector<unsigned char>
        interleaved(
            bytesPerPacket
        );

    std::vector<float>
        planar(
            static_cast<std::size_t>(
                samplesPerPacket
            ) *
            channels
        );

    OMTMediaFrame audio = {};
    audio.Type = OMTFrameType_Audio;
    audio.Timestamp = -1;
    audio.Codec = OMTCodec_FPA1;
    audio.SampleRate = sampleRate;
    audio.Channels = channels;
    audio.SamplesPerChannel =
        samplesPerPacket;
    audio.Data =
        planar.data();
    audio.DataLength =
        static_cast<int>(
            planar.size() *
            sizeof(float)
        );

    bool announced = false;

    while (running.load()) {
        const BOOL accepted =
            ConnectNamedPipe(
                pipe,
                nullptr
            );

        if (
            !accepted &&
            GetLastError() !=
                ERROR_PIPE_CONNECTED
        ) {
            if (!running.load()) {
                break;
            }

            DisconnectNamedPipe(pipe);
            continue;
        }

        while (
            running.load() &&
            readExactly(
                pipe,
                interleaved.data(),
                bytesPerPacket
            )
        ) {
            for (
                int sample = 0;
                sample < samplesPerPacket;
                ++sample
            ) {
                for (
                    int channel = 0;
                    channel < channels;
                    ++channel
                ) {
                    const std::size_t
                        sourceOffset =
                            static_cast<
                                std::size_t
                            >(
                                sample *
                                    channels +
                                channel
                            ) *
                            sizeof(float);

                    const std::size_t
                        destinationIndex =
                            static_cast<
                                std::size_t
                            >(channel) *
                                samplesPerPacket +
                            sample;

                    std::memcpy(
                        &planar[
                            destinationIndex
                        ],
                        interleaved.data() +
                            sourceOffset,
                        sizeof(float)
                    );
                }
            }

            {
                std::lock_guard<
                    std::mutex
                > lock(senderMutex);

                api.send(
                    sender,
                    &audio
                );
            }

            if (!announced) {
                announced = true;

                std::cout
                    << "OMT AUDIO ACTIVE: FPA1 "
                    << sampleRate
                    << "Hz "
                    << channels
                    << "ch"
                    << std::endl;
            }
        }

        DisconnectNamedPipe(pipe);
    }
}

} // namespace

int main(
    int argc,
    char** argv
) {
    std::string sourceName =
        "SanTTos Playout - PROGRAM";

    std::string audioPipe;
    std::string scanMode =
        "progressive";

    std::string pixelFormat =
        "i420";

    std::string qualityText =
        "low";

    bool runtimeProbe =
        false;

    int width = 1920;
    int height = 1080;
    int fpsN = 30000;
    int fpsD = 1001;
    int audioRate = 48000;
    int audioChannels = 2;

    float aspect =
        16.0f / 9.0f;

    for (
        int i = 1;
        i < argc;
        ++i
    ) {
        const std::string arg =
            argv[i];

        if (
            arg == "--capabilities"
        ) {
            std::cout
                << "SANTTOS_OMT_CAPS: "
                   "VIDEO_STDIN_V1 "
                   "AUDIO_PIPE_V1 "
                   "I420_TO_UYVY_V1 "
                   "DYNAMIC_PROFILE_V1 "
                   "RUNTIME_PROBE_V1"
                << std::endl;

            return 0;
        }

        if (
            arg == "--runtime-probe"
        ) {
            runtimeProbe = true;
            continue;
        }

        if (
            arg == "--name" &&
            i + 1 < argc
        ) {
            sourceName =
                argv[++i];
        } else if (
            arg == "--audio-pipe" &&
            i + 1 < argc
        ) {
            audioPipe =
                argv[++i];
        } else if (
            arg == "--width" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    320,
                    4096,
                    width
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--height" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    240,
                    2160,
                    height
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--fps-n" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    1,
                    120000,
                    fpsN
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--fps-d" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    1,
                    1001,
                    fpsD
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--scan" &&
            i + 1 < argc
        ) {
            scanMode =
                argv[++i];
        } else if (
            arg == "--aspect" &&
            i + 1 < argc
        ) {
            if (
                !parseAspect(
                    argv[++i],
                    aspect
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--pixel-format" &&
            i + 1 < argc
        ) {
            pixelFormat =
                argv[++i];
        } else if (
            arg == "--audio-rate" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    8000,
                    192000,
                    audioRate
                )
            ) {
                return 2;
            }
        } else if (
            arg ==
                "--audio-channels" &&
            i + 1 < argc
        ) {
            if (
                !parsePositiveInt(
                    argv[++i],
                    1,
                    32,
                    audioChannels
                )
            ) {
                return 2;
            }
        } else if (
            arg == "--quality" &&
            i + 1 < argc
        ) {
            qualityText =
                argv[++i];
        } else {
            std::cerr
                << "Argumento OMT invalido."
                << std::endl;

            return 2;
        }
    }

    if (!allowedName(sourceName)) {
        std::cerr
            << "Nome OMT invalido."
            << std::endl;

        return 2;
    }

    if (
        !audioPipe.empty() &&
        !allowedPipe(audioPipe)
    ) {
        std::cerr
            << "Pipe OMT invalido."
            << std::endl;

        return 2;
    }

    if (
        width % 2 != 0 ||
        height % 2 != 0
    ) {
        std::cerr
            << "Resolucao OMT deve usar "
               "dimensoes pares."
            << std::endl;

        return 2;
    }

    if (
        scanMode != "progressive" &&
        scanMode != "interlaced"
    ) {
        std::cerr
            << "Varredura OMT invalida."
            << std::endl;

        return 2;
    }

    if (
        pixelFormat != "i420" &&
        pixelFormat != "uyvy" &&
        pixelFormat != "bgra"
    ) {
        std::cerr
            << "Pixel format OMT invalido."
            << std::endl;

        return 2;
    }

    OmtApi api;

    if (!api.load()) {
        std::cerr
            << "ERRO: libomt.dll nao "
               "encontrada ou incompleta."
            << std::endl;

        return 1;
    }

    omt_send_t* sender =
        api.create(
            sourceName.c_str(),
            qualityFromText(
                qualityText
            )
        );

    if (!sender) {
        std::cerr
            << "ERRO: OMT sender nao "
               "pode ser criado."
            << std::endl;

        return 1;
    }

    if (runtimeProbe) {
        std::cout
            << "OMT RUNTIME READY"
            << std::endl;

        api.destroy(sender);

        if (api.shutdown) {
            api.shutdown();
        }

        return 0;
    }

    if (api.setInfo) {
        OMTSenderInfo info = {};

        const std::string product =
            "SanTTos Playout";

        const std::string manufacturer =
            "SanTTos";

        const std::string version =
            "1.0";

        std::strncpy(
            info.ProductName,
            product.c_str(),
            sizeof(info.ProductName) - 1
        );

        std::strncpy(
            info.Manufacturer,
            manufacturer.c_str(),
            sizeof(info.Manufacturer) - 1
        );

        std::strncpy(
            info.Version,
            version.c_str(),
            sizeof(info.Version) - 1
        );

        api.setInfo(
            sender,
            &info
        );
    }

    std::mutex senderMutex;

    HANDLE audioHandle =
        INVALID_HANDLE_VALUE;

    std::atomic<bool>
        audioRunning{true};

    std::thread audioThread;

    if (!audioPipe.empty()) {
        audioHandle =
            CreateNamedPipeA(
                audioPipe.c_str(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE |
                    PIPE_READMODE_BYTE |
                    PIPE_WAIT,
                1,
                65536,
                65536,
                0,
                nullptr
            );

        if (
            audioHandle ==
            INVALID_HANDLE_VALUE
        ) {
            std::cerr
                << "ERRO: pipe de audio "
                   "OMT nao pode ser criado."
                << std::endl;

            api.destroy(sender);

            if (api.shutdown) {
                api.shutdown();
            }

            return 1;
        }

        audioThread =
            std::thread(
                [&]() {
                    receiveAudio(
                        audioHandle,
                        api,
                        sender,
                        senderMutex,
                        audioRunning,
                        audioRate,
                        audioChannels
                    );
                }
            );

        std::cout
            << "OMT AUDIO PIPE READY:"
            << audioPipe
            << std::endl;
    }

    _setmode(
        _fileno(stdin),
        _O_BINARY
    );

    const std::size_t inputSize =
        inputFrameSize(
            width,
            height,
            pixelFormat
        );

    std::vector<std::uint8_t>
        inputFrame(
            inputSize,
            0
        );

    std::vector<std::uint8_t>
        convertedUyvy;

    if (pixelFormat == "i420") {
        convertedUyvy.resize(
            static_cast<std::size_t>(
                width
            ) *
            height *
            2
        );
    }

    OMTMediaFrame video = {};
    video.Type =
        OMTFrameType_Video;

    video.Timestamp = -1;
    video.Width = width;
    video.Height = height;
    video.FrameRateN = fpsN;
    video.FrameRateD = fpsD;
    video.AspectRatio = aspect;
    video.ColorSpace =
        OMTColorSpace_BT709;

    video.Flags =
        scanMode == "interlaced"
            ? OMTVideoFlags_Interlaced
            : OMTVideoFlags_None;

    if (pixelFormat == "bgra") {
        video.Codec =
            OMTCodec_BGRA;

        video.Stride =
            width * 4;
    } else {
        video.Codec =
            OMTCodec_UYVY;

        video.Stride =
            width * 2;
    }

    video.DataLength =
        video.Stride *
        height;

    std::cout
        << "OMT ONLINE: "
        << sourceName
        << std::endl;

    std::cout
        << "OMT VIDEO PROFILE: "
        << width
        << "x"
        << height
        << " "
        << fpsN
        << "/"
        << fpsD
        << " "
        << scanMode
        << " "
        << pixelFormat
        << " QUALITY="
        << qualityText
        << std::endl;

    while (
        std::cin.read(
            reinterpret_cast<char*>(
                inputFrame.data()
            ),
            static_cast<
                std::streamsize
            >(inputSize)
        )
    ) {
        if (pixelFormat == "i420") {
            i420ToUyvy(
                inputFrame.data(),
                convertedUyvy.data(),
                width,
                height
            );

            video.Data =
                convertedUyvy.data();
        } else {
            video.Data =
                inputFrame.data();
        }

        std::lock_guard<
            std::mutex
        > lock(senderMutex);

        api.send(
            sender,
            &video
        );
    }

    if (audioThread.joinable()) {
        audioRunning.store(false);

        HANDLE wake =
            CreateFileA(
                audioPipe.c_str(),
                GENERIC_WRITE,
                0,
                nullptr,
                OPEN_EXISTING,
                0,
                nullptr
            );

        if (
            wake !=
            INVALID_HANDLE_VALUE
        ) {
            CloseHandle(wake);
        }

        audioThread.join();
    }

    if (
        audioHandle !=
        INVALID_HANDLE_VALUE
    ) {
        CloseHandle(audioHandle);
    }

    api.destroy(sender);

    if (api.shutdown) {
        api.shutdown();
    }

    return 0;
}
