const config = require('./config');

const mongoose = require('mongoose');
mongoose.connect(config.mongo_url);
mongoose.connection.on('error', () => {
    throw new Error('Unable to connect to ' + config.mongo_url);
});

const server = require('./lib/server').createServer(config);
server.listen(config.port || process.env.PORT || 8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});
