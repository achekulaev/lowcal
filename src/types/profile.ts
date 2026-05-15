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
