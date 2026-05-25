# Lowcal Terminal Orchestrator — bash shell integration
# Used as --rcfile so bash auto-detects interactive mode from the PTY.
# Replays the bash login startup chain in user space (bash -l does not
# honour --rcfile), then installs the PROMPT_COMMAND hook.

# --- login startup chain ---
if [ -f /etc/profile ]; then
    source /etc/profile
fi
for _f in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [ -f "$_f" ]; then
        source "$_f"
        break
    fi
done
unset _f
if [ -f ~/.bashrc ]; then
    source ~/.bashrc
fi

# --- hook ---
__lowcal_precmd() {
    local _ec=$?
    printf '\033]133;D;%d\007' "$_ec"
}
PROMPT_COMMAND="__lowcal_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
