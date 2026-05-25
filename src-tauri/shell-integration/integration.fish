# Lowcal Terminal Orchestrator — fish postexec hook
# Sourced via `fish -l -C "source '<path>'"` which runs after config.fish.
function __lowcal_postexec --on-event fish_postexec
    printf '\033]133;D;%d\007' $status
end
