// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// black-and-white twins integration file its own server port and the storage env
// the media suite uses. Imported FIRST by media-twins.test.js, so the port is set
// before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3027"
process.env.MEDIA_MIN_FREE_BYTES = process.env.MEDIA_MIN_FREE_BYTES || "0"
