const config = require('./config');

const mongoose = require('mongoose');
const mongo = (process.env.DEBUG || config.debug) ? config.mongo.test : config.mongo.production;
mongoose.connect(mongo.url, mongo.options );
mongoose.connection.on('error', console.error.bind(console, 'connection error:'));

const server = require('./lib/server').createServer(config);
server.listen(process.env.PORT || config.port || 8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});
