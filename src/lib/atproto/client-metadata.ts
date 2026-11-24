import type { OAuthClientMetadataInput } from '@atproto/oauth-types';

import { SCOPE } from './scopes';

export const PROD_ORIGIN = 'https://tidysky.io';

/**
 * The burned-in client metadata. This object must stay byte-for-byte equivalent
 * to `static/client-metadata.json` (the client_id URL); the test in
 * `client-metadata.test.ts` keeps the two from drifting apart.
 */
export const clientMetadata: OAuthClientMetadataInput = {
	client_id: `${PROD_ORIGIN}/client-metadata.json`,
	client_name: 'TidySky',
	client_uri: PROD_ORIGIN,
	logo_uri: `${PROD_ORIGIN}/icons/icon-192.png`,
	policy_uri: `${PROD_ORIGIN}/privacy`,
	redirect_uris: [`${PROD_ORIGIN}/`],
	scope: SCOPE,
	grant_types: ['authorization_code', 'refresh_token'],
	response_types: ['code'],
	token_endpoint_auth_method: 'none',
	application_type: 'web',
	dpop_bound_access_tokens: true
};
