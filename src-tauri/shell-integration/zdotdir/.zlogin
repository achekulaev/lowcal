# Lowcal Terminal Orchestrator — zsh ZDOTDIR shim (.zlogin)
# Chain to the user's real .zlogin only; no hook here.
_lowcal_orig="${LOWCAL_ORIG_ZDOTDIR:-$HOME}"
if [ -f "$_lowcal_orig/.zlogin" ]; then
    source "$_lowcal_orig/.zlogin"
fi
unset _lowcal_orig
