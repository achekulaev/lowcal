# Lowcal Terminal Orchestrator — zsh ZDOTDIR shim (.zshenv)
# Chain to the user's real .zshenv only; no hook here.
_lowcal_orig="${LOWCAL_ORIG_ZDOTDIR:-$HOME}"
if [ -f "$_lowcal_orig/.zshenv" ]; then
    source "$_lowcal_orig/.zshenv"
fi
unset _lowcal_orig
