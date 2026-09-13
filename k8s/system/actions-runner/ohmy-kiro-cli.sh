#!/usr/bin/env bash
# Temporary, repo-scoped bridge for trusted legacy/headless review calls.
# Keep the vendor binary and every opaque argument/stream unchanged.
set -euo pipefail

ohmy_kiro_compat() {
    if [[ ${1-} == chat ]]; then
        # Non-exported locals preserve identically named caller environment data.
        local +x -a argv=("$@")
        local +x legacy=0 headless=0 explicit_engine=0 index option_end=${#argv[@]}
        for ((index=1; index<${#argv[@]}; index++)); do
            case "${argv[index]}" in
                --) option_end=$index; break ;;
                --legacy-ui|--classic) legacy=1 ;;
                --no-interactive) headless=1 ;;
                --agent-engine|--agent-engine=*|--v1|--v2|--v3) explicit_engine=1 ;;
            esac
        done
        if ((legacy && headless && !explicit_engine)); then
            exec /home/runner/.local/bin/kiro-cli \
                "${argv[@]:0:option_end}" --agent-engine v1 "${argv[@]:option_end}"
        fi
    fi
    exec /home/runner/.local/bin/kiro-cli "$@"
}

ohmy_kiro_compat "$@"
