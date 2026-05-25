# Lowcal Terminal Orchestrator — zsh precmd hook
# Sourced from zdotdir/.zshrc AFTER the user's real .zshrc has run.
# Do NOT use `emulate -L zsh` here — it would revert every setopt the
# user's rc made (including PROMPT_SUBST, breaking oh-my-zsh / p10k).

# Capture $? before anything else can clobber it, then emit OSC 133;D.
__lowcal_precmd() {
    local _ec=$?
    printf '\033]133;D;%d\007' "$_ec"
}

# Use add-zsh-hook (zsh built-in) so the registration is safe and
# idempotent even if other frameworks also manipulate precmd_functions.
autoload -Uz add-zsh-hook
add-zsh-hook precmd __lowcal_precmd

