#include <Processing.NDI.Lib.h>

#include <cstdint>
#include <iostream>
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

    // Mantem uma imagem preta valida ate o primeiro frame chegar.
    NDIlib_send_send_video_v2(
        sender,
        &videoFrame
    );

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

        videoFrame.p_data =
            frame.data();

        // Cada frame completo lido do FFmpeg e enviado uma unica vez.
        // clock_video=true faz o NDI aplicar o pacing de 29.97 fps.
        NDIlib_send_send_video_v2(
            sender,
            &videoFrame
        );
    }

    NDIlib_send_destroy(sender);
    NDIlib_destroy();

    return 0;
}
