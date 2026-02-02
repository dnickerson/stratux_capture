#!/bin/bash
# Stop capture script for Stratux
# Gracefully stops the capture service and outputs the current capture filename

CAPTURE_DIR="/home/pi"
STATE_FILE="$CAPTURE_DIR/capture_state.conf"
PID_FILE="$CAPTURE_DIR/capture.pid"

# Read current state
get_capture_file() {
    if [ -f "$STATE_FILE" ]; then
        source "$STATE_FILE"
        echo "$OUTPUT_FILE"
    else
        echo ""
    fi
}

# Get capture status
get_status() {
    if [ -f "$STATE_FILE" ]; then
        source "$STATE_FILE"
        echo "$STATE"
    else
        echo "UNKNOWN"
    fi
}

# Stop the capture service
stop_capture() {
    local capture_file=$(get_capture_file)

    # Stop via systemctl (preferred method)
    systemctl stop stratux_capture 2>/dev/null

    # Also try direct PID kill as fallback
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null
            sleep 1
        fi
    fi

    echo "$capture_file"
}

# Handle command line arguments
case "$1" in
    status)
        get_status
        ;;
    file)
        get_capture_file
        ;;
    stop)
        stop_capture
        ;;
    *)
        echo "Usage: $0 {status|file|stop}"
        exit 1
        ;;
esac
