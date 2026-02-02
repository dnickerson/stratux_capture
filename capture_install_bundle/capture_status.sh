#!/bin/bash
# Capture Status Monitor - Large ANSI Display
# Shows real-time capture status with data flow verification

STATE_FILE="/home/pi/capture_state.conf"
LOG_FILE="/home/pi/capture_monitor.log"
REFRESH_INTERVAL=2
STALL_THRESHOLD=30  # seconds without data = stalled

# ANSI colors
RED='\033[1;31m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
MAGENTA='\033[1;35m'
CYAN='\033[1;36m'
WHITE='\033[1;37m'
RESET='\033[0m'
DIM='\033[2m'
BLINK='\033[5m'

# Large block letters using Unicode blocks
declare -A LETTERS
LETTERS[R]="███▄▄
█   █
███▀
█  █
█   █ "
LETTERS[U]="█   █
█   █
█   █
█   █
 ███  "
LETTERS[N]="█   █
██  █
█ █ █
█  ██
█   █ "
LETTERS[I]="█████
  █
  █
  █
█████ "
LETTERS[G]=" ████
█
█  ██
█   █
 ███  "
LETTERS[S]=" ████
█
 ███
    █
████  "
LETTERS[T]="█████
  █
  █
  █
  █   "
LETTERS[O]=" ███
█   █
█   █
█   █
 ███  "
LETTERS[P]="████
█   █
████
█
█     "
LETTERS[E]="█████
█
████
█
█████ "
LETTERS[D]="████
█   █
█   █
█   █
████  "
LETTERS[A]=" ███
█   █
█████
█   █
█   █ "
LETTERS[L]="█
█
█
█
█████ "
LETTERS[W]="█   █
█   █
█ █ █
█ █ █
 █ █  "
LETTERS[C]=" ████
█
█
█
 ████ "
LETTERS[K]="█   █
█  █
███
█  █
█   █ "
LETTERS[H]="█   █
█   █
█████
█   █
█   █ "
LETTERS[!]="  █
  █
  █

  █   "
LETTERS[ ]="



      "

# Print word in large letters
print_large() {
    local word="$1"
    local color="$2"
    local lines=("" "" "" "" "")

    for ((i=0; i<${#word}; i++)); do
        local char="${word:$i:1}"
        local letter="${LETTERS[$char]}"
        if [ -z "$letter" ]; then
            letter="${LETTERS[ ]}"
        fi

        IFS=$'\n' read -rd '' -a letter_lines <<< "$letter"
        for j in {0..4}; do
            lines[$j]+="${letter_lines[$j]} "
        done
    done

    echo -e "${color}"
    for line in "${lines[@]}"; do
        echo "    $line"
    done
    echo -e "${RESET}"
}

# Get file size
get_file_size() {
    local file="$1"
    if [ -f "$file" ]; then
        stat -c%s "$file" 2>/dev/null || echo 0
    else
        echo 0
    fi
}

# Format bytes
format_bytes() {
    local bytes=$1
    if [ $bytes -ge 1048576 ]; then
        echo "$(echo "scale=2; $bytes / 1048576" | bc) MB"
    elif [ $bytes -ge 1024 ]; then
        echo "$(echo "scale=2; $bytes / 1024" | bc) KB"
    else
        echo "$bytes bytes"
    fi
}

# Check if capture process is actually running
check_process_running() {
    if [ -f "$STATE_FILE" ]; then
        source "$STATE_FILE"
        if [ -n "$CAPTURE_PID" ] && kill -0 "$CAPTURE_PID" 2>/dev/null; then
            return 0
        fi
        if [ -n "$MAIN_PID" ] && kill -0 "$MAIN_PID" 2>/dev/null; then
            return 0
        fi
    fi
    # Also check by process name
    pgrep -f "Raspberry_Capture.sh" >/dev/null 2>&1
    return $?
}

# Main monitoring loop
monitor() {
    local last_size=0
    local last_check_time=$(date +%s)
    local last_data_time=$(date +%s)
    local current_file=""

    while true; do
        clear
        echo ""
        echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${RESET}"
        echo -e "${CYAN}║          STRATUX CAPTURE MONITOR                               ║${RESET}"
        echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${RESET}"
        echo ""

        local now=$(date +%s)
        local status="UNKNOWN"
        local status_color="$YELLOW"
        local output_file=""
        local file_size=0
        local data_rate=0
        local process_running=false

        # Read state file
        if [ -f "$STATE_FILE" ]; then
            source "$STATE_FILE"
            status="${STATE:-UNKNOWN}"
            output_file="${OUTPUT_FILE:-}"
        else
            status="NO STATE FILE"
        fi

        # Check if process is actually running
        if check_process_running; then
            process_running=true
        fi

        # Get current file info
        if [ -n "$output_file" ] && [ -f "$output_file" ]; then
            file_size=$(get_file_size "$output_file")
            current_file="$output_file"
        fi

        # Calculate data rate and detect stalls
        local time_diff=$((now - last_check_time))
        if [ $time_diff -gt 0 ] && [ "$current_file" = "$output_file" ]; then
            local size_diff=$((file_size - last_size))
            if [ $size_diff -gt 0 ]; then
                data_rate=$((size_diff / time_diff))
                last_data_time=$now
            fi
        fi

        local seconds_since_data=$((now - last_data_time))

        # Determine actual status
        local display_status="$status"
        if [ "$status" = "RUNNING" ]; then
            if ! $process_running; then
                display_status="CRASHED"
                status_color="$RED"
            elif [ $seconds_since_data -gt $STALL_THRESHOLD ] && [ $file_size -gt 0 ]; then
                display_status="STALLED"
                status_color="$YELLOW"
            else
                display_status="RUNNING"
                status_color="$GREEN"
            fi
        elif [ "$status" = "STOPPED" ]; then
            status_color="$BLUE"
        elif [ "$status" = "ERROR" ] || [ "$status" = "FATAL" ]; then
            status_color="$RED"
        elif [ "$status" = "DIED" ]; then
            status_color="$RED"
        else
            status_color="$YELLOW"
        fi

        # Print large status
        print_large "$display_status" "$status_color"

        echo ""
        echo -e "${WHITE}────────────────────────────────────────────────────────────────${RESET}"

        # Status details
        if $process_running; then
            echo -e "  Process:     ${GREEN}● RUNNING${RESET}"
        else
            echo -e "  Process:     ${RED}○ NOT RUNNING${RESET}"
        fi

        if [ -n "$output_file" ]; then
            echo -e "  Output File: ${CYAN}$(basename "$output_file")${RESET}"
            echo -e "  File Size:   ${WHITE}$(format_bytes $file_size)${RESET}"
        else
            echo -e "  Output File: ${DIM}(none)${RESET}"
        fi

        if [ "$display_status" = "RUNNING" ] && [ $data_rate -gt 0 ]; then
            echo -e "  Data Rate:   ${GREEN}~$data_rate bytes/sec${RESET}"
        elif [ "$display_status" = "RUNNING" ]; then
            echo -e "  Data Rate:   ${YELLOW}waiting for data...${RESET}"
        fi

        if [ $seconds_since_data -gt 5 ] && [ "$display_status" = "RUNNING" ]; then
            echo -e "  Last Data:   ${YELLOW}${seconds_since_data}s ago${RESET}"
        fi

        # Warnings
        echo ""
        if [ "$display_status" = "STALLED" ]; then
            echo -e "  ${BLINK}${YELLOW}⚠ WARNING: No data received for ${seconds_since_data} seconds!${RESET}"
            echo -e "  ${YELLOW}  Check serial connection and USB cable.${RESET}"
        elif [ "$display_status" = "CRASHED" ]; then
            echo -e "  ${BLINK}${RED}⚠ ERROR: Process died but state shows RUNNING!${RESET}"
            echo -e "  ${RED}  Restart the service: sudo systemctl restart stratux_capture${RESET}"
        elif ! $process_running && [ "$status" != "STOPPED" ]; then
            echo -e "  ${RED}⚠ Capture service is not running${RESET}"
            echo -e "  ${DIM}  Start with: sudo systemctl start stratux_capture${RESET}"
        fi

        # Last log entries
        echo ""
        echo -e "${WHITE}────────────────────────────────────────────────────────────────${RESET}"
        echo -e "  ${DIM}Recent log:${RESET}"
        if [ -f "$LOG_FILE" ]; then
            tail -3 "$LOG_FILE" | while read line; do
                echo -e "  ${DIM}$line${RESET}"
            done
        fi

        echo ""
        echo -e "${DIM}  Updated: $(date '+%Y-%m-%d %H:%M:%S')   |   Press Ctrl+C to exit${RESET}"

        # Save for next iteration
        last_size=$file_size
        last_check_time=$now

        sleep $REFRESH_INTERVAL
    done
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${RESET}Exiting..."; exit 0' INT

# Run monitor
monitor
