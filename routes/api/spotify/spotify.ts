// Initializer for Spotify API handler
import SpotifyWebApi from "spotify-web-api-node";
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from "../api.js";
export const spotifyApi = new SpotifyWebApi();
spotifyApi.setClientId(SPOTIFY_CLIENT_ID);
spotifyApi.setClientSecret(SPOTIFY_CLIENT_SECRET);