#pragma once

// Compile-only/simulation shim. NEVER use for the real release build.
// The production sender is built against the licensed NDI 6 SDK.
#include <chrono>
#include <cstdint>
#include <iostream>
#include <thread>

typedef void* NDIlib_send_instance_t;
typedef std::int64_t NDIlib_timecode_t;
static constexpr NDIlib_timecode_t NDIlib_send_timecode_synthesize = INT64_MAX;
static constexpr int NDIlib_FourCC_type_BGRA = 1;
static constexpr int NDIlib_frame_format_type_progressive = 1;

struct NDIlib_send_create_t {
    const char* p_ndi_name = nullptr;
    const char* p_groups = nullptr;
    bool clock_video = false;
    bool clock_audio = false;
};

struct NDIlib_video_frame_v2_t {
    int xres = 0;
    int yres = 0;
    int FourCC = 0;
    int frame_rate_N = 0;
    int frame_rate_D = 0;
    float picture_aspect_ratio = 0;
    int frame_format_type = 0;
    NDIlib_timecode_t timecode = 0;
    unsigned char* p_data = nullptr;
    int line_stride_in_bytes = 0;
};

inline bool NDIlib_initialize() { return true; }
inline NDIlib_send_instance_t NDIlib_send_create(const NDIlib_send_create_t*) {
    return reinterpret_cast<void*>(0x1);
}
inline void NDIlib_send_send_video_v2(NDIlib_send_instance_t, const NDIlib_video_frame_v2_t*) {
    std::cout << "NDI_STUB_SEND" << std::endl;
    std::this_thread::sleep_for(std::chrono::milliseconds(33));
}
inline void NDIlib_send_destroy(NDIlib_send_instance_t) {}
inline void NDIlib_destroy() {}
