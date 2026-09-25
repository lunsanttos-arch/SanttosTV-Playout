#include <Processing.NDI.Lib.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

#include <fcntl.h>
#include <io.h>

int main()
{
    constexpr int width = 1920;
    constexpr int height = 1080;

    constexpr std::size_t frameSize =
        static_cast<std::size_t>(width) *
        static_cast<std::size_t>(height) *
        4;

    std::cout
        << "Santtos TV - iniciando engine NDI..."
        << std::endl;

    if (!NDIlib_initialize())
    {
        std::cerr
            << "ERRO: NDI nao pode ser inicializado."
            << std::endl;
        return 1;
    }

    NDIlib_send_create_t senderSettings = {};
    senderSettings.p_ndi_name =
        "Santtos TV - PROGRAM";
    senderSettings.p_groups = nullptr;
    senderSettings.clock_video = true;
    senderSettings.clock_audio = false;

    NDIlib_send_instance_t sender =
        NDIlib_send_create(
            &senderSettings
        );

    if (!sender)
    {
        std::cerr
            << "ERRO: nao foi possivel criar o sender NDI."
            << std::endl;

        NDIlib_destroy();
        return 1;
    }

    _setmode(
        _fileno(stdin),
        _O_BINARY
    );

    std::vector<std::uint8_t>
        frame(frameSize, 0);

    for (
        std::size_t offset = 3;
        offset < frameSize;
        offset += 4
    )
    {
        frame[offset] = 255;
    }

    NDIlib_video_frame_v2_t
        videoFrame = {};

    videoFrame.xres = width;
    videoFrame.yres = height;
    videoFrame.FourCC =
        NDIlib_FourCC_type_BGRA;
    videoFrame.frame_rate_N = 30000;
    videoFrame.frame_rate_D = 1001;
    videoFrame.picture_aspect_ratio =
        16.0f / 9.0f;
    videoFrame.frame_format_type =
        NDIlib_frame_format_type_progressive;
    videoFrame.timecode =
        NDIlib_send_timecode_synthesize;
    videoFrame.line_stride_in_bytes =
        width * 4;
    videoFrame.p_data =
        frame.data();

    std::cout
        << "NDI ONLINE: Santtos TV - PROGRAM"
        << std::endl;

    std::cout
        << "1920x1080 29.97p BGRA"
        << std::endl;

    std::cout
        << "Aguardando frames do PROGRAM..."
        << std::endl;

    // Keep a valid black signal while no video file is on air.
    std::vector<std::uint8_t> black(frameSize, 0);
    for (std::size_t offset = 3; offset < frameSize; offset += 4)
        black[offset] = 255;
    NDIlib_video_frame_v2_t blackFrame = videoFrame;
    blackFrame.p_data = black.data();

    std::mutex senderMutex;
    std::atomic<bool> shuttingDown(false);
    const auto steadyMillis = []() -> std::int64_t {
        using namespace std::chrono;
        return duration_cast<milliseconds>(
            steady_clock::now().time_since_epoch()
        ).count();
    };
    std::atomic<std::int64_t> lastProgramFrame(steadyMillis());
    std::uint64_t acknowledgedFrames = 0;

    NDIlib_send_send_video_v2(sender, &blackFrame);

    // The stdin reader may block between programs. The idle worker keeps
    // the source alive, provides a black fallback, and emits a heartbeat.
    std::thread idleWorker([&]() {
        while (!shuttingDown.load())
        {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            if (shuttingDown.load()) break;

            std::cout << "NDI HEARTBEAT" << std::endl;
            if (steadyMillis() - lastProgramFrame.load() < 2000) continue;

            std::lock_guard<std::mutex> guard(senderMutex);
            if (steadyMillis() - lastProgramFrame.load() >= 2000)
                NDIlib_send_send_video_v2(sender, &blackFrame);
        }
    });

    while (true)
    {
        std::cin.read(
            reinterpret_cast<char*>(
                frame.data()
            ),
            static_cast<std::streamsize>(
                frameSize
            )
        );

        if (
            std::cin.gcount() !=
            static_cast<std::streamsize>(
                frameSize
            )
        )
        {
            break;
        }

        videoFrame.p_data = frame.data();

        // SDK acceptance is acknowledged only after the synchronous send.
        // This confirms PROGRAM frames entered the NDI sender, not their
        // reception by a remote transmitter or a distant TV.
        {
            std::lock_guard<std::mutex> guard(senderMutex);
            lastProgramFrame.store(steadyMillis());
            NDIlib_send_send_video_v2(sender, &videoFrame);
            ++acknowledgedFrames;
            std::cout << "FRAME_ACK " << acknowledgedFrames << std::endl;
        }
    }

    shuttingDown.store(true);
    idleWorker.join();
    NDIlib_send_destroy(sender);
    NDIlib_destroy();

    return 0;
}
