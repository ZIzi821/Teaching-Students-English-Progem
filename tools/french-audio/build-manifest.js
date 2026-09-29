/*
 * Compatibility entrypoint for audio-only workflows.
 * The manifest now depends on all generated A1/A2 content, so delegate to the
 * single content build rather than rebuilding from the former A1-only pair.
 */
'use strict';

require('../french-content/build-content');
