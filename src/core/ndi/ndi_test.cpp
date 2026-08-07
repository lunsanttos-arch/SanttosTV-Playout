
#include <Processing.NDI.Lib.h>

#include <cstdint>
#include <iostream>
#include <vector>

int main()
{
    std::cout
        << "Santtos TV - iniciando NDI..."
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

    constexpr int width = 1920;
    constexpr int height = 1080;

    std::vector<std::uint8_t> frame(
        width * height * 4
    );

    /*
        Barras verticais simples em BGRA.

        O objetivo agora nao e qualidade:
        e provar que o sender NDI funciona.
    */

    for (int y = 0; y < height; ++y)
    {
        for (int x = 0; x < width; ++x)
        {
            const int bar =
                (x * 7) / width;

            std::uint8_t r = 0;
            std::uint8_t g = 0;
            std::uint8_t b = 0;

            switch (bar)
            {
                case 0:
                    r = 255;
                    g = 255;
                    b = 255;
                    break;

                case 1:
                    r = 255;
                    g = 255;
                    b = 0;
                    break;

                case 2:
                    r = 0;
                    g = 255;
                    b = 255;
                    break;

                case 3:
                    r = 0;
                    g = 255;
                    b = 0;
                    break;

                case 4:
                    r = 255;
                    g = 0;
                    b = 255;
                    break;

                case 5:
                    r = 255;
                    g = 0;
                    b = 0;
                    break;

                default:
                    r = 0;
                    g = 0;
                    b = 255;
                    break;
            }

            const std::size_t offset =
                static_cast<std::size_t>(
                    (y * width + x) * 4
                );

            frame[offset + 0] = b;
            frame[offset + 1] = g;
            frame[offset + 2] = r;
            frame[offset + 3] = 255;
        }
    }

    NDIlib_video_frame_v2_t videoFrame = {};

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

    videoFrame.p_data =
        frame.data();

    videoFrame.line_stride_in_bytes =
        width * 4;

    std::cout
        << "NDI ONLINE: Santtos TV - PROGRAM"
        << std::endl;

    std::cout
        << "1920x1080 29.97p"
        << std::endl;

    std::cout
        << "Pressione CTRL+C para encerrar."
        << std::endl;

    while (true)
    {
        NDIlib_send_send_video_v2(
            sender,
            &videoFrame
        );
    }

    NDIlib_send_destroy(sender);
    NDIlib_destroy();

    return 0;
}
