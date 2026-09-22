// A local teaching server for this repository's existing AngelScript adapter.
// It speaks the Unreal binary protocol, NOT DAP, and does not embed Unreal/AS.
#ifdef _WIN32
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
using Socket = SOCKET;
using AddressSize = int;
constexpr Socket InvalidSocket = INVALID_SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
using Socket = int;
using AddressSize = socklen_t;
constexpr Socket InvalidSocket = -1;
#endif

#include "protocol.h"
#include "demo_runtime.h"
#include <chrono>
#include <memory>
#include <unordered_map>

using wire::Type;
using wire::Writer;
using Clock = std::chrono::steady_clock;

struct SocketEnvironment
{
    SocketEnvironment()
    {
#ifdef _WIN32
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0)
            throw std::runtime_error("WSAStartup failed");
#endif
    }
    ~SocketEnvironment()
    {
#ifdef _WIN32
        WSACleanup();
#endif
    }
};

struct SocketHandle
{
    Socket value;
    explicit SocketHandle(Socket socket) : value(socket) {}
    SocketHandle(const SocketHandle&) = delete;
    SocketHandle& operator=(const SocketHandle&) = delete;
    ~SocketHandle()
    {
        if (value == InvalidSocket)
            return;
#ifdef _WIN32
        closesocket(value);
#else
        close(value);
#endif
    }
};

enum class RunMode { Continue, Into, Over, Out };
struct Client
{
    SocketHandle socket;
    int id;
    wire::Bytes pending;
    DemoRuntime runtime;
    std::unordered_map<int, int> breakpoints; // breakpoint id -> resolved source line
    bool active = false, running = false, closing = false, skipCurrentBreakpoint = false;
    RunMode mode = RunMode::Continue;
    int startDepth = 1;
    Clock::time_point nextTick{};

    Client(Socket handle, int clientId) : socket(handle), id(clientId) {}
};

void sendMessage(Client& client, Type type, const Writer& payload = {})
{
    const auto frame = wire::serverFrame(type, payload);
    std::size_t sent = 0;
    while (sent < frame.size())
    {
#ifdef MSG_NOSIGNAL
        constexpr int flags = MSG_NOSIGNAL;
#else
        constexpr int flags = 0;
#endif
        const auto count = ::send(client.socket.value,
            reinterpret_cast<const char*>(frame.data() + sent),
            static_cast<int>(frame.size() - sent), flags);
        if (count <= 0)
            throw std::runtime_error("Socket send failed");
        sent += static_cast<std::size_t>(count);
    }
    std::cout << "[" << client.id << "] -> type=" << int(type)
              << " payload=" << payload.bytes.size() << '\n';
}

// VS native breakpoint #1: script stop is a state change, NOT a blocked socket thread.
void sendStopped(Client& client, const SourceMap& source, const std::string& reason)
{
    client.running = false;
    std::cout << "[" << client.id << "] STOP " << reason << " " << source.module
              << ":" << source.line(client.runtime.pc) << '\n';
    sendMessage(client, Type::HasStopped, Writer{}.string(reason).string("").string(""));
}

void resume(Client& client, RunMode mode)
{
    if (!client.active)
        return;
    client.mode = mode;
    client.startDepth = client.runtime.depth();
    client.skipCurrentBreakpoint = true; // don't immediately hit the stop we just left
    client.running = true;
    client.nextTick = Clock::now();
    sendMessage(client, Type::HasContinued);
}

void sendDatabase(Client& client)
{
    // Settings v1: automaticImports=true; do not advertise Unreal asset creation.
    sendMessage(client, Type::DebugDatabaseSettings, Writer{}.integer(1).boolean(true));
    static const std::string database = R"json({
        "UObject": {"properties": {}, "methods": {}},
        "FDemoState": {
            "isStruct": true,
            "doc": "Native state provided by the C++ demo, not Unreal.",
            "properties": {
                "LastResult": ["int64", "The last stored Counter value."],
                "ExecutedInstructions": ["int64", "Number of simulated instructions executed."]
            },
            "methods": {}
        },
        "__Demo": {
            "properties": {"State": ["FDemoState", "Expand this value in the debugger."]},
            "methods": {"Print": {
                "name": "Print", "return": "void", "isProperty": false,
                "args": [{"name": "Value", "type": "int64"}],
                "doc": "Prints to the C++ server console (not the VS Code Debug Console)."
            }}
        }
    })json";
    sendMessage(client, Type::DebugDatabase, Writer{}.string(database));
    sendMessage(client, Type::DebugDatabaseFinished);
    sendMessage(client, Type::AssetDatabaseInit);
    sendMessage(client, Type::AssetDatabaseFinished);
}

void sendCallStack(Client& client, const SourceMap& source)
{
    Writer payload;
    payload.integer(client.active ? client.runtime.depth() : 0);
    if (client.active)
    {
        const bool inAdd = client.runtime.depth() == 2;
        payload.string(inAdd ? "Add" : "Main").string(source.filename)
            .integer(source.line(client.runtime.pc)).string(source.module);
        if (inAdd)
            payload.string("Main").string(source.filename)
                .integer(source.line(Instruction::Call)).string(source.module);
    }
    sendMessage(client, Type::CallStack, payload);
}

void writeValue(Writer& payload, const Value& value)
{
    payload.string(value.name).string(value.text).string(value.type).boolean(value.hasMembers);
    // DebugServerVersion=1: NO address/valueSize fields. Not data-breakpoint capable.
}

// VS native breakpoint #2: inspect type and the decoded fields in these cases.
void handleMessage(Client& client, const SourceMap& source, Type type, wire::Reader& reader)
{
    switch (type)
    {
    case Type::RequestBreakFilters:
        sendMessage(client, Type::BreakFilters, Writer{}.integer(0));
        break;
    case Type::BreakOptions:
    {
        const auto count = reader.integer();
        if (count < 0 || count > 64)
            throw std::runtime_error("Invalid filter count");
        for (int i = 0; i < count; ++i)
            (void)reader.string(); // no exceptions/filters simulated
        break;
    }
    case Type::RequestDebugDatabase:
        sendDatabase(client);
        break;
    case Type::StartDebugging:
    {
        const int adapterVersion = reader.integer();
        std::cout << "[" << client.id << "] adapter version=" << adapterVersion << '\n';
        client.active = true;
        client.runtime.reset();
        sendMessage(client, Type::DebugServerVersion, Writer{}.integer(1));
        sendStopped(client, source, "entry");
        break;
    }
    case Type::StopDebugging:
        client.active = client.running = false;
        break;
    case Type::Disconnect:
        client.closing = true; // closes ONLY this client, never the listening server
        break;
    case Type::ClearBreakpoints:
    {
        const auto filename = reader.string();
        const auto module = reader.string();
        if (source.matches(filename, module))
            client.breakpoints.clear();
        break;
    }
    case Type::SetBreakpoint:
    {
        const auto filename = reader.string();
        const int requestedLine = reader.integer();
        const int id = reader.integer();
        const auto module = reader.string();
        const int line = source.matches(filename, module) ? source.breakpointLine(requestedLine) : -1;
        if (line > 0)
            client.breakpoints[id] = line;
        else
            client.breakpoints.erase(id);
        // Echo the client's path EXACTLY: the TS adapter keys its map by that path.
        sendMessage(client, Type::SetBreakpoint, Writer{}.string(filename).integer(line).integer(id));
        break;
    }
    case Type::Pause:
        if (client.active)
            sendStopped(client, source, "pause");
        break;
    case Type::Continue: resume(client, RunMode::Continue); break;
    case Type::StepIn: resume(client, RunMode::Into); break;
    case Type::StepOver: resume(client, RunMode::Over); break;
    case Type::StepOut: resume(client, RunMode::Out); break;
    case Type::RequestCallStack: sendCallStack(client, source); break;
    case Type::RequestVariables:
    {
        const auto path = reader.string();
        const auto values = client.active ? client.runtime.variables(path) : std::vector<Value>{};
        Writer payload;
        payload.integer(static_cast<std::int32_t>(values.size()));
        for (const auto& value : values)
            writeValue(payload, value);
        sendMessage(client, Type::Variables, payload);
        break;
    }
    case Type::RequestEvaluate:
    {
        const auto expression = reader.string();
        const int frame = reader.integer();
        const auto value = client.active ? client.runtime.evaluate(expression, frame)
            : Value{expression, "<not debugging>", "", false};
        Writer payload;
        writeValue(payload, value);
        sendMessage(client, Type::Evaluate, payload);
        break;
    }
    case Type::StopPIE:
        if (client.active)
        {
            client.runtime.reset(); // demo-only meaning; no actual PIE exists
            sendStopped(client, source, "entry");
        }
        break;
    default:
        std::cout << "[" << client.id << "] unsupported message (ignored)\n";
        break;
    }
}

void receiveMessages(Client& client, const SourceMap& source)
{
    std::array<std::uint8_t, 4096> data{};
    const auto count = recv(client.socket.value, reinterpret_cast<char*>(data.data()),
        static_cast<int>(data.size()), 0);
    if (count <= 0)
    {
        client.closing = true;
        return;
    }
    client.pending.insert(client.pending.end(), data.begin(), data.begin() + count);
    while (!client.closing && client.pending.size() >= 4)
    {
        // TS -> server length INCLUDES the type byte; validate before allocating/reading.
        const auto length = wire::readU32(client.pending.data());
        if (length < 1 || length > wire::MaxFrameSize)
            throw std::runtime_error("Invalid inbound frame length");
        if (client.pending.size() < 4 + length)
            return; // incomplete TCP frame; continue servicing other clients
        const auto type = static_cast<Type>(client.pending[4]);
        wire::Reader reader(client.pending.data() + 5, length - 1);
        std::cout << "[" << client.id << "] <- type=" << int(type) << " length=" << length << '\n';
        handleMessage(client, source, type, reader);
        client.pending.erase(client.pending.begin(), client.pending.begin() + 4 + length);
    }
}

void tickRuntime(Client& client, const SourceMap& source, int tickMilliseconds)
{
    if (!client.active || !client.running || Clock::now() < client.nextTick)
        return;
    const auto atBreakpoint = [&] {
        const int line = source.line(client.runtime.pc);
        return std::any_of(client.breakpoints.begin(), client.breakpoints.end(),
            [line](const auto& entry) { return entry.second == line; });
    };
    if (!client.skipCurrentBreakpoint && atBreakpoint())
    {
        sendStopped(client, source, "breakpoint");
        return;
    }
    client.skipCurrentBreakpoint = false;
    client.runtime.executeInstruction();
    client.nextTick = Clock::now() + std::chrono::milliseconds(tickMilliseconds);
    const int depth = client.runtime.depth();
    if (atBreakpoint())
        sendStopped(client, source, "breakpoint");
    else if (client.mode == RunMode::Into
        || (client.mode == RunMode::Over && depth <= client.startDepth)
        || (client.mode == RunMode::Out && depth < client.startDepth))
        sendStopped(client, source, "step");
}

void runServer(const SourceMap& source, int port, int tickMilliseconds)
{
    SocketEnvironment environment;
    SocketHandle listener(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    if (listener.value == InvalidSocket)
        throw std::runtime_error("Cannot create listener");
    int enabled = 1;
#ifdef _WIN32
    setsockopt(listener.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
        reinterpret_cast<const char*>(&enabled), sizeof(enabled));
#else
    setsockopt(listener.value, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
#endif
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // never expose the demo on all interfaces
    address.sin_port = htons(static_cast<unsigned short>(port));
    if (bind(listener.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0
        || listen(listener.value, 16) != 0)
        throw std::runtime_error("Cannot listen on 127.0.0.1:" + std::to_string(port) + " (port in use?)");
    AddressSize addressSize = sizeof(address);
    if (getsockname(listener.value, reinterpret_cast<sockaddr*>(&address), &addressSize) != 0)
        throw std::runtime_error("getsockname failed");
    std::cout << "LISTENING 127.0.0.1:" << ntohs(address.sin_port) << '\n'
              << "SOURCE " << source.filename << "\nOpen its parent Script folder in VS Code.\n";

    std::vector<std::unique_ptr<Client>> clients;
    int nextClientId = 1;
    for (;;)
    {
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(listener.value, &readable);
        Socket highest = listener.value;
        for (const auto& client : clients)
        {
            FD_SET(client->socket.value, &readable);
            highest = std::max(highest, client->socket.value);
        }
        timeval timeout{};
        timeout.tv_usec = 10000;
        if (select(static_cast<int>(highest + 1), &readable, nullptr, nullptr, &timeout) < 0)
            throw std::runtime_error("select failed");
        if (FD_ISSET(listener.value, &readable))
        {
            const Socket accepted = accept(listener.value, nullptr, nullptr);
            if (accepted != InvalidSocket)
            {
                auto client = std::make_unique<Client>(accepted, nextClientId++);
                bool allowed = clients.size() < 16;
#ifndef _WIN32
                allowed = allowed && accepted < FD_SETSIZE;
#endif
                if (allowed)
                {
                    setsockopt(accepted, IPPROTO_TCP, TCP_NODELAY,
                        reinterpret_cast<const char*>(&enabled), sizeof(enabled));
#ifdef _WIN32
                    DWORD sendTimeout = 2000;
#else
                    timeval sendTimeout{2, 0};
#endif
                    setsockopt(accepted, SOL_SOCKET, SO_SNDTIMEO,
                        reinterpret_cast<const char*>(&sendTimeout), sizeof(sendTimeout));
                    std::cout << "[" << client->id << "] connected\n";
                    clients.push_back(std::move(client));
                }
            }
        }
        for (auto& client : clients)
        {
            try
            {
                if (FD_ISSET(client->socket.value, &readable))
                    receiveMessages(*client, source);
                if (!client->closing)
                    tickRuntime(*client, source, tickMilliseconds);
            }
            catch (const std::exception& error)
            {
                std::cerr << "[" << client->id << "] " << error.what() << '\n';
                client->closing = true;
            }
        }
        clients.erase(std::remove_if(clients.begin(), clients.end(), [](const auto& client) {
            if (client->closing)
                std::cout << "[" << client->id << "] disconnected\n";
            return client->closing;
        }), clients.end());
    }
}

int main(int argc, char** argv)
{
    try
    {
        std::cout << std::unitbuf;
        int port = 27100, tickMilliseconds = 300;
        std::filesystem::path script = std::filesystem::u8path(DEMO_SCRIPT_PATH);
        for (int i = 1; i < argc; ++i)
        {
            const std::string option = argv[i];
            if (option == "--help")
            {
                std::cout << "as-debug-server [--port 27100] [--tick-ms 300] [--script path/Demo.as]\n"
                          << "Port 0 selects an ephemeral port (used by tests). Ctrl+C stops the server.\n";
                return 0;
            }
            if (i + 1 == argc)
                throw std::runtime_error("Missing value for " + option);
            const std::string value = argv[++i];
            if (option == "--script")
                script = std::filesystem::u8path(value);
            else if (option == "--port" || option == "--tick-ms")
            {
                std::size_t end = 0;
                const int number = std::stoi(value, &end);
                if (end != value.size())
                    throw std::runtime_error("Invalid number: " + value);
                if (option == "--port") port = number;
                else tickMilliseconds = number;
            }
            else
                throw std::runtime_error("Unknown option: " + option);
        }
        if (port < 0 || port > 65535 || tickMilliseconds < 1 || tickMilliseconds > 10000)
            throw std::runtime_error("Port must be 0..65535 and tick-ms must be 1..10000");
        runServer(SourceMap(script), port, tickMilliseconds);
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
