#include <Processing.NDI.Lib.h>

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
constexpr int width = 1920;
constexpr int height = 1080;
constexpr int audioRate = 48000;
constexpr int audioChannels = 2;
constexpr int audioSamplesPerPacket = 960; // 20 ms
constexpr std::size_t frameSize =
    static_cast<std::size_t>(width) * height * 4;

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

void receiveAudio(HANDLE pipe, NDIlib_send_instance_t sender,
                  std::atomic<bool>& running) {
    constexpr DWORD bytesPerPacket =
        audioSamplesPerPacket * audioChannels * sizeof(float);
    std::vector<unsigned char> packed(bytesPerPacket);
    std::vector<float> planar(audioSamplesPerPacket * audioChannels);
    NDIlib_audio_frame_v2_t audio = {};
    audio.sample_rate = audioRate;
    audio.no_channels = audioChannels;
    audio.no_samples = audioSamplesPerPacket;
    audio.timecode = NDIlib_send_timecode_synthesize;
    audio.channel_stride_in_bytes = audioSamplesPerPacket * sizeof(float);
    audio.p_data = planar.data();

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
            // FFmpeg produces interleaved f32le; NDI v2 consumes planar f32.
            for (int sample = 0; sample < audioSamplesPerPacket; ++sample) {
                std::memcpy(
                    &planar[sample], packed.data() + sample * 8, sizeof(float));
                std::memcpy(
                    &planar[audioSamplesPerPacket + sample],
                    packed.data() + sample * 8 + 4, sizeof(float));
            }
            NDIlib_send_send_audio_v2(sender, &audio);
        }
        DisconnectNamedPipe(pipe);
    }
}
} // namespace

int main(int argc, char** argv) {
    std::string sourceName = "Santtos TV - PROGRAM";
    std::string audioPipe;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--capabilities") {
            std::cout << "SANTTOS_NDI_CAPS: AUDIO_PIPE_V1 NAME_ARGUMENT_V1"
                      << std::endl;
            return 0; // Must never create a sender in a capability probe.
        }
        if (arg == "--name" && i + 1 < argc) {
            sourceName = argv[++i];
        } else if (arg == "--audio-pipe" && i + 1 < argc) {
            audioPipe = argv[++i];
        } else {
            std::cerr << "Argumento NDI invalido." << std::endl;
            return 2;
        }
    }
    // Avoid accidentally publishing a test sender under PROGRAM.
    if (sourceName != "Santtos TV - PROGRAM" &&
        sourceName != "Santtos TV - QA") {
        std::cerr << "Nome NDI nao autorizado." << std::endl;
        return 2;
    }
    if (!audioPipe.empty() && !isAllowedPipe(audioPipe)) {
        std::cerr << "Caminho de pipe de audio invalido." << std::endl;
        return 2;
    }

    if (!NDIlib_initialize()) {
        std::cerr << "ERRO: NDI nao pode ser inicializado." << std::endl;
        return 1;
    }
    NDIlib_send_create_t settings = {};
    settings.p_ndi_name = sourceName.c_str();
    settings.p_groups = nullptr;
    // Audio runs on a different input thread, so both clocks can pace.
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
            audioPipe.c_str(), PIPE_ACCESS_INBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1, 65536, 65536, 0, nullptr
        );
        if (audioHandle == INVALID_HANDLE_VALUE) {
            std::cerr << "ERRO: nao foi possivel criar pipe de audio."
                      << std::endl;
            NDIlib_send_destroy(sender);
            NDIlib_destroy();
            return 1;
        }
        audioThread = std::thread([&]() {
            receiveAudio(audioHandle, sender, audioRunning);
        });
        std::cout << "NDI AUDIO PIPE READY:" << audioPipe << std::endl;
    }

    _setmode(_fileno(stdin), _O_BINARY);
    std::vector<std::uint8_t> frame(frameSize, 0);
    for (std::size_t offset = 3; offset < frameSize; offset += 4) {
        frame[offset] = 255;
    }
    NDIlib_video_frame_v2_t video = {};
    video.xres = width;
    video.yres = height;
    video.FourCC = NDIlib_FourCC_type_BGRA;
    video.frame_rate_N = 30000;
    video.frame_rate_D = 1001;
    video.picture_aspect_ratio = 16.0f / 9.0f;
    video.frame_format_type = NDIlib_frame_format_type_progressive;
    video.timecode = NDIlib_send_timecode_synthesize;
    video.line_stride_in_bytes = width * 4;
    video.p_data = frame.data();

    std::cout << "NDI ONLINE: " << sourceName << std::endl;
    std::cout << "1920x1080 29.97p BGRA" << std::endl;
    if (!audioPipe.empty()) {
        std::cout << "NDI AUDIO: PCM f32le 48kHz stereo" << std::endl;
    }
    NDIlib_send_send_video_v2(sender, &video); // black until PLAY

    while (std::cin.read(reinterpret_cast<char*>(frame.data()),
                         static_cast<std::streamsize>(frameSize))) {
        video.p_data = frame.data();
        NDIlib_send_send_video_v2(sender, &video);
    }

    if (audioThread.joinable()) {
        audioRunning.store(false);
        // Wake a thread that is blocked in ConnectNamedPipe.
        HANDLE wake = CreateFileA(audioPipe.c_str(), GENERIC_WRITE, 0,
                                  nullptr, OPEN_EXISTING, 0, nullptr);
        if (wake != INVALID_HANDLE_VALUE) CloseHandle(wake);
        // On normal application shutdown Node closes the PCM writer first.
        audioThread.join();
    }
    if (audioHandle != INVALID_HANDLE_VALUE) CloseHandle(audioHandle);
    NDIlib_send_destroy(sender);
    NDIlib_destroy();
    return 0;
}
