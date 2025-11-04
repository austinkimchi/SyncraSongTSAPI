
export interface Playlist {
    id: string;
    name: string;
    description: string;
    trackCount: number;
    href: string;
    image: string;
    ownerName?: string;
    public: boolean;
}