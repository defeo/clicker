const passport = require('passport');
const Basic = require('passport-http').BasicStrategy;
const Anon = require('passport-anonymous').Strategy;
const Bearer = require('passport-http-bearer').Strategy;
const GH = require('passport-github2').Strategy;
const models = require('./models');
const crypto = require('crypto');
const config = require('../config');

const level = exports.level = { ANONYMOUS: 0, USER: 1, PRIVILEDGED: 2, ADMIN: 3 };

/** Anonymous auth **/
Anon.prototype.authenticate = function() {
    self = this;
    models.getOrCreateUser('anonymous:', function (err, user) {
	err ? self.fail(500) : self.success(user);
    }, true, level.ANONYMOUS);
}
passport.use(new Anon());

/** Basic auth, for testing **/
passport.use(new Basic(function(user, pass, next) {
    models.getOrCreateUser('basic:' + user, next,
			   config.userCanSubscribe.basic || config.userCanSubscribe === true);
}));

/** Bearer token auth

    Bearer tokens contain the uid, cryptographically signed (HMAC)
    with the application secret, and bear an expiration date (set by
    default to `config.tokenExpiry` ms in the future).

    Bearer token auth is never open for subscription.  Other
    authentication methods can return a bearer token, in order to
    speed up authentication of returning users.
 **/
const tokenEnc = 'base64';
const createToken = exports.createToken = function(data,
						   expires=Date.now() + config.tokenExpiry,
						   hash=config.hashFunction,
						   secret=config.secret) {
    const hmac = crypto.createHmac(hash, secret);
    const message = new Buffer(JSON.stringify({ data: data, expires: expires })).toString(tokenEnc)
    hmac.update(message);
    return {
	data: data,
	expires: expires,
	token: message + '|' + hmac.digest(tokenEnc),
    };
};
const decodeToken = exports.decodeToken = function(token,
						   hash=config.hashFunction,
						   secret=config.secret) {
    const hmac = crypto.createHmac(hash, secret);
    token = token.split('|');
    hmac.update(token[0]);
    if (hmac.digest(tokenEnc) !== token[1])
	throw new Error('Invalid token');
    const message = JSON.parse(new Buffer(token[0], tokenEnc));
    if (message.expires <= Date.now())
	throw new Error('Token expired');
    return message;
};
passport.use(new Bearer(function(token, next) {
    let uid;
    try {
	uid = decodeToken(token).data;
    } catch (e) {
	next(e);
    }
    models.getOrCreateUser(uid, next, false);
}));

/** GitHub auth **/
passport.use(new GH({
    clientID: config.github.clientID,
    clientSecret: config.github.clientSecret,
    callbackURL: config.github.callbackURL || null,
}, (accessToken, refreshToken, profile, next) =>
		    models.getOrCreateUser('github:' + profile.id, next,
					   config.userCanSubscribe.github || config.userCanSubscribe === true,
					   undefined,
					   {
					       name: profile.displayName || profile.username,
					       data: profile._json,
					   })));

/** Authentications activated by default **/
exports.auth = passport.authenticate(['bearer', 'basic', 'anonymous'], { session: false });

/** GitHub authentication is treated via a special route */
exports.ghCallback = passport.authenticate('github', { session: false });
