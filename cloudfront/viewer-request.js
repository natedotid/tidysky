// Viewer-request function for tidysky.io. Redirects www to the apex and maps
// clean URLs to prerendered files and everything else without a file
// extension to the SPA fallback. Not a module: the CloudFunctions runtime
// invokes `handler` by name. Excluded from the app's ESLint config (see
// eslint.config.js).
var APEX = 'tidysky.io';
var PRERENDERED = {
	'/': '/index.html',
	'/methodology': '/methodology.html',
	'/privacy': '/privacy.html'
};

// Rebuilds a query string from CloudFront's `request.querystring` object
// ({ name: { value } } or { name: { value, multiValue: [{ value }] } } per
// AWS's "CloudFront Functions event structure" doc). Order follows the
// object's key order; CloudFront does not guarantee one.
function queryString(q) {
	var parts = [];
	for (var key in q) {
		var item = q[key];
		if (item.multiValue) {
			for (var i = 0; i < item.multiValue.length; i++) {
				parts.push(key + '=' + item.multiValue[i].value);
			}
		} else {
			parts.push(item.value === '' ? key : key + '=' + item.value);
		}
	}
	return parts.length ? '?' + parts.join('&') : '';
}

function handler(event) {
	var request = event.request;
	// Sign-in on www would fail: OAuth state is per origin and the only
	// allowed redirect URI is https://tidysky.io/, so www must never run the
	// app. Header names are always lowercase in the event object; values are
	// lowercased too, since a client may send them capitalized.
	var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
	if (host === 'www.' + APEX) {
		return {
			statusCode: 301,
			statusDescription: 'Moved Permanently',
			headers: {
				location: {
					value: 'https://' + APEX + request.uri + queryString(request.querystring || {})
				}
			}
		};
	}
	var uri = request.uri;
	if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') {
		uri = uri.slice(0, -1);
	}
	if (PRERENDERED[uri]) {
		request.uri = PRERENDERED[uri];
		return request;
	}
	if (uri.indexOf('.') !== -1) {
		return request; // a real file: assets, icons, client-metadata.json, manifest
	}
	request.uri = '/200.html';
	return request;
}
