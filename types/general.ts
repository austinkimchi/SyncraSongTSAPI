export type Provider = 'spotify' | 'apple_music' | 'soundcloud';

export enum state {
    QUEUED = "queued",
    PROCESSING = "processing",
    SUCCESS = "success",
    ERROR = "error"
}