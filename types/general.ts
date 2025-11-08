export type Provider = 'spotify' | 'apple_music' | 'soundcloud';

export enum state {
    PENDING = "pending",
    PROCESSING = "processing",
    SUCCESS = "success",
    ERROR = "error"
}