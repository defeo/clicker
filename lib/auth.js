const passport = require('passport');
const Basic = require('passport-http').BasicStrategy;
const Anon = require('passport-anonymous').Strategy;
const Bearer = require('passport-http-bearer').Strategy;
const Saml = require('passport-saml').Strategy;
const models = require('./models');
const crypto = require('crypto');
const config = require('../config');

const level = exports.level = { ANONYMOUS: 0, USER: 1, PRIVILEDGED: 2, ADMIN: 3 };

/** Anonymous auth **/
Anon.prototype.authenticate = function() {
    self = this;
    models.getOrCreateUser('anonymous:', function (err, user) {
	err ? self.fail(500) : self.success(user);
    });
}
passport.use(new Anon());

/** Basic auth, for testing **/
passport.use(new Basic(function(user, pass, next) {
    models.getOrCreateUser('basic:' + user, next);
}));

/** Bearer token auth (to be combined with SAML) **/
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
    if (hmac.digest(tokenEnc) != token[1])
	throw new Error('Invalid token');
    const message = JSON.parse(new Buffer(token[0], tokenEnc));
    if (message.expires <= Date.now())
	throw new Error('Token expired');
    return message;
};
passport.use(new Bearer(function(token, next) {
    try {
	const uid = decodeToken(token).data;
    } catch (e) {
	next(new restify.UnauthorizedError(e.message));
    }
    models.getOrCreateUser(uid, next, false);
}));

/** SAML auth **/
// function Saml(opts, verify) {
//     if (!opts.callbackUrl || !opts.casHost)
// 	throw new Error('Saml authentication requires options callbacURL and casHost');
//     if (!verify)
// 	throw new Error('Saml authentication strategy requires a verify callback');
    
//     Strategy.call(this);
//     this.name = 'saml';
//     this._verify = verify;
//     this._callbackURL = opts.callbackURL;
//     this._casHost = opts.casHost;
    
// }
// Saml.prototype.authenticate = function(req) {
//     const ticket = req.query.ticket;
//     if (ticket) {
// 	return request({
// 	    method: 'POST',
// 	    url: `${this._casHost}/serviceValidate?ticket=${ticket}&service=${this._callbackUrl}`,
// 	    headers: {
// 		'soapaction': 'http://www.oasis-open.org/committees/security',
//                 'content-type': 'text/xml',
//             },
// 	    body: `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
// 		<SOAP-ENV:Header/>
// 		<SOAP-ENV:Body>
// 		<samlp:Request xmlns:samlp="urn:oasis:names:tc:SAML:1.0:protocol" MajorVersion="1" MinorVersion="1">
// 		<samlp:AssertionArtifact>${ticket}</samlp:AssertionArtifact>
// 		</samlp:Request>
// 		</SOAP-ENV:Body>
// 		</SOAP-ENV:Envelope>`,
// 	}, (err, res, body) => (err)
// 		       ? this.fail(500, err)
// 		       : xml2js.parseString(body, (err, result) => {
// 			   if (err)
// 			       return this.fail(500, err);
// 			   console.log(JSON.stringify(result));
// 			   return this.success('toto', {});
// 		       })
// 		      );
//     } else {
// 	return this.fail(400);
//     }
// }

passport.use(new Saml({
    callbackUrl: config.saml.callbackUrl,
    entryPoint: config.saml.entryPoint,
    issuer: 'passport-saml',
}, (profile, next) => models.getOrCreateUser('saml:' + profile.nameID, next)));

/** Authentications **/
exports.auth = passport.authenticate(['bearer', 'basic', 'anonymous'], { session: false });
exports.samlCallback = (req, res, next) => {
    if (req.body)
	req.body.SAMLResponse = new Buffer(req.body.SAMLResponse).toString('base64');
    passport.authenticate('saml', { session: false })(req, res, next);
}
