#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace wire
{
using Bytes = std::vector<std::uint8_t>;
constexpr std::uint32_t MaxFrameSize = 64 * 1024;

// Explicit IDs: must match extension/src/unreal-debugclient.ts.
enum class Type : std::uint8_t
{
    RequestDebugDatabase = 1, DebugDatabase = 2,
    StartDebugging = 3, StopDebugging = 4, Pause = 5, Continue = 6,
    RequestCallStack = 7, CallStack = 8, ClearBreakpoints = 9, SetBreakpoint = 10,
    HasStopped = 11, HasContinued = 12, StepOver = 13, StepIn = 14, StepOut = 15,
    RequestVariables = 17, Variables = 18, RequestEvaluate = 19, Evaluate = 20,
    BreakOptions = 22, RequestBreakFilters = 23, BreakFilters = 24, Disconnect = 25,
    DebugDatabaseFinished = 26, AssetDatabaseInit = 27, AssetDatabaseFinished = 29,
    DebugDatabaseSettings = 31, DebugServerVersion = 33, StopPIE = 38,
};

inline std::uint32_t readU32(const std::uint8_t* data)
{
    return std::uint32_t(data[0]) | (std::uint32_t(data[1]) << 8)
        | (std::uint32_t(data[2]) << 16) | (std::uint32_t(data[3]) << 24);
}

struct Writer
{
    Bytes bytes;

    Writer& integer(std::int32_t value)
    {
        const auto bits = static_cast<std::uint32_t>(value);
        for (int i = 0; i < 4; ++i)
            bytes.push_back(static_cast<std::uint8_t>(bits >> (i * 8)));
        return *this;
    }

    Writer& boolean(bool value) { return integer(value ? 1 : 0); }

    // Server -> client supports UTF-8. Length is BYTES, including the final NUL.
    Writer& string(const std::string& value)
    {
        if (value.size() >= MaxFrameSize - 4)
            throw std::runtime_error("String too large");
        integer(static_cast<std::int32_t>(value.size() + 1));
        bytes.insert(bytes.end(), value.begin(), value.end());
        bytes.push_back(0);
        return *this;
    }
};

class Reader
{
public:
    Reader(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}

    std::int32_t integer()
    {
        require(4);
        const auto bits = readU32(data_ + offset_);
        offset_ += 4;
        const auto value = bits <= 0x7fffffffu ? std::int64_t(bits)
            : std::int64_t(bits) - 0x100000000ll;
        return static_cast<std::int32_t>(value);
    }

    std::string string()
    {
        const auto length = integer();
        // The existing TS writer uses positive-length binary/Latin-1 strings.
        // This demo uses ASCII paths/expressions; it deliberately does not
        // pretend to support Unicode requests or the engine's full string API.
        if (length < 0)
            throw std::runtime_error("UTF-16 requests are not supported by this demo");
        require(static_cast<std::size_t>(length));
        if (length == 0)
            return {};
        if (data_[offset_ + length - 1] != 0)
            throw std::runtime_error("Missing string terminator");
        std::string value(reinterpret_cast<const char*>(data_ + offset_), length - 1);
        offset_ += length;
        return value;
    }

private:
    void require(std::size_t count) const
    {
        if (count > size_ - offset_)
            throw std::runtime_error("Truncated message payload");
    }
    const std::uint8_t* data_;
    std::size_t size_;
    std::size_t offset_ = 0;
};

inline Bytes serverFrame(Type type, const Writer& payload)
{
    if (payload.bytes.size() > MaxFrameSize)
        throw std::runtime_error("Frame too large");
    // IMPORTANT: current TS readers expect payload length, excluding type.
    // In the opposite direction TS writers include type in the length.
    Writer frame;
    frame.integer(static_cast<std::int32_t>(payload.bytes.size()));
    frame.bytes.push_back(static_cast<std::uint8_t>(type));
    frame.bytes.insert(frame.bytes.end(), payload.bytes.begin(), payload.bytes.end());
    return frame.bytes;
}
} // namespace wire
