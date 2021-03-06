// Require useful stuff
var http = require('http');
var url = require('url');
var fs = require('fs');

var logger = require('winston');
var connect = require('connect');
var connectRoute = require('connect-route');

var DocumentHandler = require('./lib/document_handler.js');

// Load the configuration and set some defaults
var config = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
config.port = process.env.PORT || config.port || 8080;
config.host = process.env.HOST || config.host || 'localhost';

// Set up the logger
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {colorize: true, level: "verbose"});
logger.info("Welcome to Hastebin Plus!");

// build the store from the config on-demand - so that we don't load it for statics
var Store = require('./lib/store_file.js');
var preferredStore = new Store(config.dataPath);
logger.info('Path to data: ' + config.dataPath);

// Compress the static assets
if (config.compressStaticAssets) {
	var list = fs.readdirSync('./static');
	var i, item, sourceFile, dest;

	// First compress CSS
	var CleanCSS = require('clean-css');
	for (i = 0; i < list.length; i++) {
		item = list[i];
		if ((item.indexOf('.css') === item.length - 4) && (item.indexOf('.min.css') === -1)) {
			dest = item.substring(0, item.length - 4) + '.min' + item.substring(item.length - 4);
			sourceFile = fs.readFileSync('./static/' + item, 'utf8');
			fs.writeFileSync('./static/' + dest, new CleanCSS().minify(sourceFile).styles, 'utf8');
			logger.info('Compressed: ' + item + ' ==> ' + dest);
		}
	}

	// Compress JavaScript
	var UglifyJS = require("uglify-js");
	for (i = 0; i < list.length; i++) {
		item = list[i];
		if ((item.indexOf('.js') === item.length - 3) && (item.indexOf('.min.js') === -1)) {
			dest = item.substring(0, item.length - 3) + '.min' + item.substring(item.length - 3);
			fs.writeFileSync('./static/' + dest, UglifyJS.minify('./static/' + item).code, 'utf8');
			logger.info('Compressed: ' + item + ' ==> ' + dest);
		}
	}
}

// Send the static documents into the preferred store, skipping expirations
var path, data;
for (var name in config.documents) {
	if (config.documents.hasOwnProperty(name)) {
		path = config.documents[name];
		data = fs.readFileSync(path, 'utf8');
		logger.info('Loading static document: ' + name + " ==> " + path);
		if (data) {
			preferredStore.set(name, data, function (cb) {
			}, true);
		} else {
			logger.warn('Failed to load static document: ' + name + " ==> " + path);
		}
	}
}

// Pick up a key generator
var gen = require('./lib/key_generator.js');
var keyGenerator = new gen();

// Configure the document handler
var documentHandler = new DocumentHandler({
	store: preferredStore,
	maxLength: config.maxLength,
	keyLength: config.keyLength,
	keyGenerator: keyGenerator
});

// Set the server up with a static cache
connect.createServer(
	// First look for api calls
	connectRoute(function (app) {
		// get raw documents
		app.get('/raw/:id', function (request, response) {
			return documentHandler.handleRawGet(request.params.id, response, !!config.documents[request.params.id]);
		});
		// add documents
		app.post('/documents', function (request, response) {
			return documentHandler.handlePost(request, response);
		});
		// get documents
		app.get('/documents/:id', function (request, response) {
			var skipExpire = !!config.documents[request.params.id];
			return documentHandler.handleGet(request.params.id, response, skipExpire);
		});
	}),
	// Otherwise, static
	connect.static(__dirname + '/static', {maxAge: config.staticMaxAge}),
	// Then we can loop back - and everything else should be a token, so route it back to /index.html
	connectRoute(function (app) {
		app.get('/:id', function (request, response, next) {
			request.url = request.originalUrl = '/index.html';
			next();
		});
	}),
	connect.static(__dirname + '/static', {maxAge: config.staticMaxAge})
).listen(config.port, config.host);

logger.info('Done! Listening on ' + config.host + ':' + config.port);