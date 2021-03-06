const config = require('./config');

const mongoose = require('mongoose');
mongoose.connect(config.mongo.url, config.mongo.options);
mongoose.connection.on('error', console.error.bind(console, 'connection error:'));
mongoose.connection.on('connected', console.log.bind(console, 'Connected to ' + config.mongo.url));

const server = require('./lib/server').createServer(config);
server.listen(config.port, function() {
  console.log('%s listening at %s', server.name, server.url);
});
