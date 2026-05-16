export type SessionStatus = "stopped" | "running";

export interface ProfileDto {
  id: string;
  displayName: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  tags: string[];
  warmOnStart?: boolean;
  startCommandOnAppOpen?: boolean;
  status: SessionStatus;
  /**
   * `true` from the moment **Start** (sidebar / stage header) or
   * `startCommandOnAppOpen` injects the saved command, until the matching **Stop**
   * clears it. Combined with `status === "stopped"` and a non-zero `lastExitCode`,
   * this drives the red "failed" dot. Manual typing in the PTY never sets this.
   */
  startedViaUi: boolean;
  /**
   * Exit code of the **most recent** Start-injected command, captured via an APC
   * marker the shell prints after the command (see `inject_profile_command` in
   * `src-tauri/src/lib.rs`). `null` until the first injected command exits, or
   * while a Start / Stop is in progress.
   */
  lastExitCode: number | null;
}

export interface ProfileFormState {
  displayName: string;
  command: string;
  cwd: string;
  tagsStr: string;
  envStr: string;
  warmOnStart: boolean;
  startCommandOnAppOpen: boolean;
}
