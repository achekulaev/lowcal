# Lowcal Terminal Orchestrator — zsh ZDOTDIR shim (.zshrc)
# PITFALL 1: Do NOT use `emulate -L zsh` — it reverts every setopt the
#            user's rc makes (breaks PROMPT_SUBST → oh-my-zsh / p10k).
# PITFALL 2: Do NOT use ${0:A:h} to locate siblings — in an auto-sourced
#            .zshrc $0 is the shell name ("zsh"), not the script path.
#            Use $LOWCAL_INTEGRATION_DIR (exported by Rust at spawn time).

# Restore ZDOTDIR to the user's original value so nested zsh invocations
# and subshells see the real dotfiles, not our shim directory.
ZDOTDIR="${LOWCAL_ORIG_ZDOTDIR:-$HOME}"

# Install our hook BEFORE sourcing the user's .zshrc so we survive even if
# the user's rc calls `exec`, `exit`, or does a non-local return. The hook
# prepends itself via add-zsh-hook so any subsequent framework setup that
# appends to precmd_functions doesn't displace it.
source "$LOWCAL_INTEGRATION_DIR/integration.zsh"

# Source the user's real .zshrc if present.
if [ -f "$ZDOTDIR/.zshrc" ]; then
    source "$ZDOTDIR/.zshrc"
fi
