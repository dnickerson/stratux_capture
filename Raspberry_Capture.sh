#!/bin/bash
#2025-07-11 - Background capture with monitoring and clean shutdown

# Script to capture data from /dev/ttyUSB0 into a file
# Runs in background, freeing the terminal
# Use Raspberry_Rename.sh to stop capture and rename the file

SERIAL_PORT="/dev/ttyUSB0"
BAUD_RATE=115200
CONFIG_FILE="stream_counter.conf"
LOG_FILE="capture_monitor.log"
STATE_FILE="capture_state.conf"
PID_FILE="capture.pid"
MAX_RESTARTS=5
MONITOR_INTERVAL=10
STALL_TIMEOUT=60

# Get script directory for consistent file paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Logging function
log_message() {
    local level="$1"
    local message="$2"
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$level] $message" >> "$LOG_FILE"
}

# Write current state for other scripts to read
write_state() {
    local state="$1"
    local pid="$2"
    local file="$3"
    cat > "$STATE_FILE" << EOF
STATE=$state
CAPTURE_PID=$pid
OUTPUT_FILE=$file
MAIN_PID=$$
UPDATED=$(date '+%Y-%m-%d %H:%M:%S')
EOF
}

# Check if serial port exists and is accessible
check_serial_port() {
    if [ ! -e "$SERIAL_PORT" ]; then
        log_message "ERROR" "Serial port $SERIAL_PORT does not exist"
        return 1
    fi
    if [ ! -r "$SERIAL_PORT" ] || [ ! -w "$SERIAL_PORT" ]; then
        log_message "ERROR" "No read/write permission on $SERIAL_PORT"
        return 1
    fi
    return 0
}

# Configure serial port with error handling
configure_serial() {
    if stty -F "$SERIAL_PORT" "$BAUD_RATE" 2>>"$LOG_FILE"; then
        log_message "INFO" "Serial port configured: $BAUD_RATE baud"
        return 0
    else
        log_message "ERROR" "Failed to configure serial port"
        return 1
    fi
}

# Get next output filename
get_output_filename() {
    if [ ! -f "$CONFIG_FILE" ]; then
        echo "COUNTER=0" > "$CONFIG_FILE"
    fi
    source "$CONFIG_FILE"
    COUNTER=$((COUNTER + 1))
    echo "COUNTER=$COUNTER" > "$CONFIG_FILE"
    printf "stream_%04d.txt" "$COUNTER"
}

# Start the capture process
start_capture() {
    local output_file="$1"
    cat "$SERIAL_PORT" > "$output_file" &
    echo $!
}

# Check if already running
check_already_running() {
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if kill -0 "$old_pid" 2>/dev/null; then
            echo "Capture already running (PID $old_pid)"
            echo "Use Raspberry_Rename.sh to stop it first"
            exit 1
        else
            rm -f "$PID_FILE"
        fi
    fi
}

# Clean up on exit
cleanup() {
    log_message "INFO" "Shutting down capture..."
    write_state "STOPPED" "" "$current_output_file"
    # Kill cat process if running
    if [ -n "$capture_pid" ] && kill -0 "$capture_pid" 2>/dev/null; then
        kill "$capture_pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
    log_message "INFO" "Capture stopped"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

# Main capture loop (runs in background)
run_capture() {
    local restart_count=0
    local last_size=0
    local stall_count=0

    # Check serial port BEFORE incrementing counter (avoids wasting stream numbers)
    if ! check_serial_port; then
        log_message "FATAL" "Cannot access serial port, exiting"
        write_state "ERROR" "" ""
        rm -f "$PID_FILE"
        exit 1
    fi

    if ! configure_serial; then
        log_message "FATAL" "Cannot configure serial port, exiting"
        write_state "ERROR" "" ""
        rm -f "$PID_FILE"
        exit 1
    fi

    # Only increment counter after confirming serial port is ready
    current_output_file=$(get_output_filename)

    capture_pid=$(start_capture "$current_output_file")
    log_message "INFO" "Started capture PID $capture_pid -> $current_output_file"
    write_state "RUNNING" "$capture_pid" "$current_output_file"

    # Monitoring loop
    while true; do
        sleep "$MONITOR_INTERVAL"

        # Check if capture process died
        if ! kill -0 "$capture_pid" 2>/dev/null; then
            log_message "ERROR" "Capture process $capture_pid died"
            write_state "DIED" "" "$current_output_file"

            restart_count=$((restart_count + 1))
            if [ $restart_count -ge $MAX_RESTARTS ]; then
                log_message "FATAL" "Max restarts ($MAX_RESTARTS) reached, exiting"
                write_state "FATAL" "" ""
                rm -f "$PID_FILE"
                exit 1
            fi

            log_message "INFO" "Attempting restart $restart_count/$MAX_RESTARTS"

            # Wait for serial port
            local wait_count=0
            while ! check_serial_port; do
                sleep 5
                wait_count=$((wait_count + 1))
                if [ $wait_count -ge 12 ]; then
                    log_message "ERROR" "Serial port not available after 60s"
                    break
                fi
            done

            if check_serial_port && configure_serial; then
                # Continue with same file after restart
                capture_pid=$(start_capture "$current_output_file")
                log_message "INFO" "Restarted capture PID $capture_pid"
                write_state "RUNNING" "$capture_pid" "$current_output_file"
                last_size=$(stat -c%s "$current_output_file" 2>/dev/null || echo 0)
                stall_count=0
            fi
            continue
        fi

        # Check data flow
        if [ -f "$current_output_file" ]; then
            current_size=$(stat -c%s "$current_output_file" 2>/dev/null || echo 0)

            if [ "$current_size" -eq "$last_size" ]; then
                stall_count=$((stall_count + 1))
                stall_seconds=$((stall_count * MONITOR_INTERVAL))

                if [ $stall_seconds -ge $STALL_TIMEOUT ]; then
                    log_message "WARN" "No data for ${stall_seconds}s, restarting capture"
                    kill "$capture_pid" 2>/dev/null
                    write_state "STALLED" "" "$current_output_file"
                fi
            else
                bytes_received=$((current_size - last_size))
                log_message "INFO" "Received $bytes_received bytes (total: $current_size)"
                stall_count=0
                restart_count=0
            fi
            last_size=$current_size
        fi
    done
}

# === MAIN ===

check_already_running

log_message "INFO" "========== Capture script starting =========="
log_message "INFO" "Serial port: $SERIAL_PORT @ $BAUD_RATE baud"

# Run in background
echo $$ > "$PID_FILE"
echo "Starting capture in background (PID $$)"
echo "Output file: $(get_output_filename | sed 's/stream_/stream_/' )"
echo "Log file: $LOG_FILE"
echo ""
echo "Run Raspberry_Rename.sh when flight is complete"

# Daemonize: close stdin, redirect stdout/stderr to log
exec 0</dev/null
exec 1>>"$LOG_FILE"
exec 2>>"$LOG_FILE"

run_capture
