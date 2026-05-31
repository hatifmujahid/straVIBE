// The ONE official straVIBE backend. Hardcoded and NON-overridable: the CLI does
// not read --api or STRAVIBE_API, so an installed copy of the published package
// can't be pointed at a third-party endpoint. Both the usage ingest and the
// account-auth flow derive from this single base.
//
// Caveat (be honest): straVIBE is open source under MIT and this constant ships
// in plaintext. The lock prevents *casual* redirection of the published package;
// it does not stop someone forking the repo and editing this line. To test
// against a staging server, change API_BASE here in a local checkout.
//
// >>> Replace API_BASE with your production domain before publishing. <<<
export const API_BASE = "https://randi-unparticularized-carri.ngrok-free.dev";

// Derived endpoints — keep paths in one place.
export const INGEST_URL = `${API_BASE}/v1/import`;
export const authUrl = (path) => `${API_BASE}/auth/cli/${path}`;
