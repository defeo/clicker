const passport = require('passport');
const Basic = require('passport-http').BasicStrategy;
const Anon = require('passport-anonymous').Strategy;
const Bearer = require('passport-http-bearer').Strategy;
const Saml = require('passport-saml').Strategy;
const models = require('./models');
const crypto = require('crypto');
const request = require('request');
const xml2js = require('xml2js');
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
						   expiry=Date.now() + config.tokenExpiry,
						   cipher=config.cipher,
						   secret=config.secret) {
    var ciph = crypto.createCipher(cipher, secret);
    return ciph.update(JSON.stringify({ data: data, expiry: expiry }), 'utf-8', tokenEnc)
	+ ciph.final(tokenEnc);
};
const decodeToken = exports.decodeToken = function(token,
						   cipher=config.cipher,
						   secret=config.secret) {
    var ciph = crypto.createDecipher(cipher, secret);
    data = JSON.parse(ciph.update(token, tokenEnc, 'utf-8')
		      + ciph.final('utf-8'));
    if (data.expiry <= Date.now()) {
	throw new Error('Token expired');
    }
    return data;
};
passport.use(new Bearer(function(token, next) {
    try {
	models.getOrCreateUser(decodeToken(token).data, next, false);
    } catch (e) {
	next(e);
    }
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
