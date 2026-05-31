// The leaderboard backend, hardcoded so users never have to pass --api in their
// install/download scripts. Resolution order everywhere is:
//   explicit --api flag  →  STRAVIBE_API env  →  saved login creds  →  DEFAULT_API
//
// >>> Replace this with your production ingest URL before publishing. <<<
export const DEFAULT_API = "https://randi-unparticularized-carri.ngrok-free.dev/v1/import";
