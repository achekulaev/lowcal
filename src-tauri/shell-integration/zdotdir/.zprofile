# Lowcal Terminal Orchestrator — zsh ZDOTDIR shim (.zprofile)
# Chain to the user's real .zprofile only; no hook here.
_lowcal_orig="${LOWCAL_ORIG_ZDOTDIR:-$HOME}"
if [ -f "$_lowcal_orig/.zprofile" ]; then
    source "$_lowcal_orig/.zprofile"
fi
unset _lowcal_orig
