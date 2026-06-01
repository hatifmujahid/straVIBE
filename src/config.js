// The ONE official straVIBE backend. Hardcoded and NON-overridable: the CLI does
// not read --api or STRAVIBE_API, so an installed copy of the published package
// can't be pointed at a third-party endpoint. Both the usage ingest and the
// account-auth flow derive from this single base.
//
// Caveat (be honest): the published package ships this constant in plaintext, so
// the lock only prevents *casual* redirection — anyone can read it from an install
// or edit it in a local copy (which the proprietary license forbids, but can't
// technically prevent). To test against a staging server, change API_BASE here in
// a local checkout.
export const API_BASE = "https://stravibe.vercel.app";

// Derived endpoints — keep paths in one place.
export const INGEST_URL = `${API_BASE}/v1/import`;
export const authUrl = (path) => `${API_BASE}/auth/cli/${path}`;
