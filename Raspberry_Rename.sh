#!/bin/bash
#2025-07-11 - Stops capture permanently and renames the data file

# Script to stop capture and rename the stream file
# Use after flight is complete, then SFTP to download

STATE_FILE="capture_state.conf"
PID_FILE="capture.pid"
LOG_FILE="script_log.txt"

# Get script directory for consistent file paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Logging function
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
    echo "$1"
}

# Get current date and time for file naming
current_time=$(date +%Y-%m-%d_%H-%M-%S)

log_message "========== Stopping capture and renaming file =========="

# Determine which file to rename
file_to_rename=""

# Check state file for current output file
if [ -f "$STATE_FILE" ]; then
    source "$STATE_FILE"
    file_to_rename="$OUTPUT_FILE"
    log_message "Current capture file: $OUTPUT_FILE"
fi

# Stop the main capture script via PID file
if [ -f "$PID_FILE" ]; then
    main_pid=$(cat "$PID_FILE")
    if kill -0 "$main_pid" 2>/dev/null; then
        log_message "Stopping capture script (PID $main_pid)..."
        kill "$main_pid" 2>/dev/null

        # Wait for clean shutdown
        wait_count=0
        while kill -0 "$main_pid" 2>/dev/null && [ $wait_count -lt 10 ]; do
            sleep 1
            wait_count=$((wait_count + 1))
        done

        if kill -0 "$main_pid" 2>/dev/null; then
            log_message "Force killing capture script..."
            kill -9 "$main_pid" 2>/dev/null
        fi

        log_message "Capture script stopped"
    else
        log_message "Capture script not running (stale PID file)"
    fi
    rm -f "$PID_FILE"
else
    log_message "No PID file found"
fi

# Also kill any orphaned cat processes (belt and suspenders)
pids=$(pgrep -f "cat /dev/ttyUSB0" 2>/dev/null)
if [ -n "$pids" ]; then
    for pid in $pids; do
        log_message "Stopping orphaned cat process (PID $pid)"
        kill "$pid" 2>/dev/null
    done
    sleep 1
fi

# If we don't have a file from state, find it
if [ -z "$file_to_rename" ] || [ ! -f "$file_to_rename" ]; then
    file_to_rename=$(ls -1t stream_*.txt 2>/dev/null | grep -E 'stream_[0-9]{4}\.txt$' | head -n 1)
fi

# Ensure data is flushed to disk
sync

# Rename the output file
if [ -n "$file_to_rename" ] && [ -f "$file_to_rename" ]; then
    file_size=$(stat -c%s "$file_to_rename" 2>/dev/null || echo 0)

    if [ "$file_size" -eq 0 ]; then
        log_message "File $file_to_rename is empty (0 bytes), deleting"
        rm -f "$file_to_rename"
    else
        new_file="stream_${current_time}.txt"

        if mv "$file_to_rename" "$new_file"; then
            log_message "SUCCESS: Renamed to $new_file ($file_size bytes)"
            echo ""
            echo "==================================="
            echo "File ready for download:"
            echo "  $new_file"
            echo "  Size: $file_size bytes"
            echo "==================================="
        else
            log_message "ERROR: Failed to rename $file_to_rename"
        fi
    fi
else
    log_message "No stream file found to rename"
fi

# Clean up state file
rm -f "$STATE_FILE"

log_message "Done"
