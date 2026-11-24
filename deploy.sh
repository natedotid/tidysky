#!/usr/bin/env bash
# Deploy build/ to S3 and invalidate the CloudFront distribution in front of
# it. BUCKET and DIST_ID come from the environment, or from a deploy.env
# file next to this script (see deploy.env.example).
#
#   AWS_PROFILE=... ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/deploy.env" ]; then
	# The file holds the defaults; the environment wins.
	_b="${BUCKET-}"
	_d="${DIST_ID-}"
	set -a
	. "$SCRIPT_DIR/deploy.env"
	set +a
	[ -n "$_b" ] && BUCKET="$_b"
	[ -n "$_d" ] && DIST_ID="$_d"
fi

if [ -z "${BUCKET:-}" ] || [ -z "${DIST_ID:-}" ]; then
	echo "BUCKET and DIST_ID are not set." >&2
	echo "" >&2
	echo "Put them in a deploy.env file next to deploy.sh (see deploy.env.example)," >&2
	echo "or export them before running:" >&2
	echo "" >&2
	echo "  AWS_PROFILE=... BUCKET=... DIST_ID=... ./deploy.sh" >&2
	exit 1
fi

# 1. Gates, then build.
npm run check && npm run check:sw && npm run lint && npm run test:unit -- --run && npm run build

# macOS drops .DS_Store files into folders opened in Finder; static/ ones get
# copied into build/. Remove them so they're never uploaded, and so step 3's
# --delete prunes any already in the bucket.
find build -name '.DS_Store' -type f -delete

# 2. Hashed Vite assets: the hash in the name is the validity: immutable for
# a year.
aws s3 sync build/_app/immutable "s3://$BUCKET/_app/immutable" \
	--cache-control "public, max-age=31536000, immutable"

# 3. Everything else revalidates at the edge. --delete prunes files removed
# since the last deploy; the exclude keeps step 2's assets in place.
aws s3 sync build "s3://$BUCKET" --delete \
	--exclude "_app/immutable/*" \
	--cache-control "public, max-age=0, must-revalidate"

# 4. Two files need a content-type (and, for client-metadata.json, a short
# cache) that step 3's blanket header doesn't cover.
aws s3 cp build/client-metadata.json "s3://$BUCKET/client-metadata.json" \
	--content-type application/json --cache-control "public, max-age=300"
aws s3 cp build/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" \
	--content-type application/manifest+json --cache-control "public, max-age=0, must-revalidate"

# 5. Invalidate the edge cache so the new HTML is picked up.
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"

echo "Deployed build/ to s3://$BUCKET; invalidated $DIST_ID."
