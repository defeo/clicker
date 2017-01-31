require('dotenv').config();
module.exports = {
    port: process.env.PORT || 8080,
    debug: process.env.DEBUG || process.env.NODE_ENV !== 'production' || false,
    mongo: {
	url: process.env.MONGO_URL || 'mongodb://localhost/clicker',
	options: {
	    server: { socketOptions: { keepAlive: 30000, connectTimeoutMS: 30000 } }
	}
    },
    hashFunction: "sha256",
    secret: process.env.SECRET || "Pulcinella's",
    tokenExpiry : process.env.TOKEN_EXPIRY || 15552000000,
    userCanSubscribe: {
	basic: process.env.SUB_BASIC || false,
	github: process.env.SUB_GITHUB || true,
    },
    github: {
	clientID: process.env.GH_CLIENT_ID || '<CLIENT_ID>',
	clientSecret: process.env.GH_CLIENT_SECRET || '<CLIENT_SECRET>',
	callbackURL: process.env.GH_CALLBACK_URL || '/login/github'
    },
    clientURL: process.env.CLIENT_URL || 'http://localhost:4000/',
    remoteServer: process.env.REMOTE_SERVER || null,
    authToken: process.env.AUTH_TOKEN || null
}
