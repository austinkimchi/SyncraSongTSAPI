# SyncraSongTSAPI – Backend Service
<div style="text-align: center;">
  <p>
    <a href="https://nodejs.org/">
      <img src="https://img.shields.io/badge/Node.js-22+-green.svg" alt="Node.js" />
    </a>
    <a href="https://www.typescriptlang.org/">
      <img src="https://img.shields.io/badge/TypeScript-5.x-blue.svg" alt="TypeScript" />
    </a>
    <a href="https://expressjs.com/">
      <img src="https://img.shields.io/badge/Express.js-API%20Server-lightgrey.svg" alt="Express.js" />
    </a>
    <a href="https://www.mongodb.com/">
      <img src="https://img.shields.io/badge/MongoDB-Atlas-brightgreen.svg" alt="MongoDB" />
    </a>
  </p>
</div>

### Notice
This repository contains the **back-end API** that powers the SyncraSongTS web app.  
Front-end repo: [SyncraSongTS (version3)](https://github.com/austinkimchi/SyncraSongTS/tree/version3)

---

## Overview

**SyncraSongTSAPI** is a TypeScript / Node.js REST API used by the SyncraSongTS front-end to:

- Authenticate with **Spotify**, **Apple Music**, and **SoundCloud**
- Fetch and cache user playlists and tracks
- Resolve cross-platform track matches
- Orchestrate **playlist transfer jobs** (queued, retried, and processed via a worker)

The service exposes a thin HTTP interface over a more complex transfer pipeline:  
incoming requests from the UI are validated, normalized into internal transfer jobs, and handed off to a background worker that talks to the provider APIs and updates MongoDB.

---

## Features

- **OAuth 2.x Integration**
  - Handles auth flows for third-party music platforms
  - Persists provider tokens and refresh tokens in MongoDB
- **Playlist & Track Aggregation**
  - Fetches user playlists from each connected platform
  - Normalizes platform-specific fields into a common internal model
- **Cross-Platform Transfer Engine**
  - Creates transfer jobs to move playlists between:
    - Spotify ↔ Apple Music ↔ SoundCloud :contentReference[oaicite:1]{index=1}
  - Delegates track-level work to specialized matching services
- **Background Job Processing**
  - Uses a job scheduler/queue (see `agenda/` and `worker.ts`) to:
    - Process long-running transfers off the main request thread
    - Throttle and batch requests to external APIs
- **MongoDB Persistence**
  - Centralizes user accounts, platform connections, playlists, and transfer jobs
  - Designed for MongoDB Atlas but works with any compatible MongoDB deployment
- **Typed API Surface**
  - Shared DTOs and domain types in `types/` for safer backend refactors and easier front-end integration

---

## Tech Stack

- **Runtime:** Node.js 22+
- **Language:** TypeScript (strict mode)
- **Framework:** Express.js (HTTP routing and middleware)
- **Database:** MongoDB (Atlas recommended)
- **Job Processing:** Agenda-based worker (backed by MongoDB)
- **Auth:** OAuth 2.x + provider-specific flows (Spotify, Apple Music, SoundCloud)
- **Tooling:** `ts-node` / `ts-node-dev` (dev), `tsc` (build), npm scripts (see `package.json`)

---

## Project Structure

High-level layout:

```text
SyncraSongTSAPI/
├── agenda/             # Agenda job definitions (transfer workers, schedulers)
├── routes/             # Express route handlers (auth, playlists, transfers, health)
├── services/
│   └── transfer/       # Platform-specific transfer + matching logic
├── types/              # Shared TS types/interfaces for API + internal models
├── main.ts             # HTTP server bootstrap + route wiring
├── mongo.ts            # MongoDB connection + helpers
├── worker.ts           # Background worker entrypoint (Agenda runner)
├── package.json        # Dependencies + npm scripts
└── tsconfig.json       # TypeScript configuration
