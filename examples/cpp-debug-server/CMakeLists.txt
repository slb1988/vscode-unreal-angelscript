cmake_minimum_required(VERSION 3.20)
project(AngelScriptDebugServerDemo LANGUAGES CXX)

add_executable(as-debug-server src/main.cpp src/protocol.h src/demo_runtime.h)
target_compile_features(as-debug-server PRIVATE cxx_std_17)
target_compile_definitions(as-debug-server PRIVATE
    DEMO_SCRIPT_PATH="${CMAKE_CURRENT_SOURCE_DIR}/Script/Demo.as")
if(MSVC)
    target_compile_options(as-debug-server PRIVATE /W4 /permissive- /utf-8)
else()
    target_compile_options(as-debug-server PRIVATE -Wall -Wextra -Wpedantic)
endif()
if(WIN32)
    target_link_libraries(as-debug-server PRIVATE ws2_32)
endif()

# Generated .sln: F5 starts this native process, not VS Code or Unreal.
set_property(DIRECTORY PROPERTY VS_STARTUP_PROJECT as-debug-server)
set_target_properties(as-debug-server PROPERTIES
    VS_DEBUGGER_COMMAND_ARGUMENTS "--port 27100"
    VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}")

include(CTest)
find_program(NODE_EXECUTABLE node)
if(BUILD_TESTING AND NODE_EXECUTABLE)
    add_test(NAME protocol-smoke
        COMMAND "${NODE_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/protocol-smoke.mjs"
                "$<TARGET_FILE:as-debug-server>")
    set_tests_properties(protocol-smoke PROPERTIES TIMEOUT 30)
endif()
