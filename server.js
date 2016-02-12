const config = require('./config');

const mongoose = require('mongoose');
const models = require('./lib/models');
mongoose.connect(config.mongo_url);
mongoose.connection.on('error', () => {
    throw new Error('Unable to connect to ' + config.mongo_url);
});

const Promise = require('bluebird');

const restify = require('restify');
const server = restify.createServer();
server.use(restify.queryParser({ mapParams: false }));
server.use(restify.bodyParser({ mapParams: false }));

/** CORS **/
server.opts('.*', (req, res, next) => {
    if (req.headers.origin && req.headers['access-control-request-method']) {
        res.header('Access-Control-Allow-Origin', req.headers.origin);
        res.header('Access-Control-Allow-Headers', 'authorization, content-type');
        res.header('Allow', req.headers['access-control-request-method']);
        res.header('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
        res.send(204);
        return next(false);
    } else {
        next(new restify.MethodNotAllowedError);
    }
});
server.use(restify.CORS( { headers: ['authorization'] }));

/** Authentication **/

const auth = require('./lib/auth');
server.use(auth.auth);

server.get({ path: '/login/saml', version: '1.0.0' }, auth.samlCallback);
server.post({ path: '/login/saml', version: '1.0.0' }, auth.samlCallback,
	    (req, res, next) => {
		if (req.user) {
		    const token = auth.createToken(req.user._id, Date.now() + 20*1000);
		    return res.redirect(`${config.saml.clientUrl}?token=${token.token}`, next);
		} else {
		    return next(new restify.UnauthorizedError("Unexpected SAML error"));
		}
	    });

function authorize(level) {
    return (req, res, next) => 
	req.user.level < level
	? next(new restify.ForbiddenError()) 
	: next();
}

server.get({ path: '/token', version: '1.0.0' },
	   authorize(auth.level.USER),
	   (req, res, next) => {
	       if (req.user) {
		   const token = auth.createToken(req.user._id);
		   res.send({
		       uid: token.data,
		       expires: token.expires,
		       token: token.token,
		   });
		   return next();
	       } else {
		   return next(new restify.UnauthorizedError("Authenticate first"));	
	       }
	   });

/** Polls **/

server.get({ path: '/polls', version: '1.0.0' }, (req, res, next) => {
    models.Poll.find().select('_id title')
	.lean().exec()
	.then((doc) => { res.send(doc); return next(); })
	.catch((err) => next(err))
	.done()
});

server.get({ path: '/polls/:pollid', version: '1.0.0' },
	   (req, res, next) => models.Poll.findById(req.params.pollid)
	   .lean().exec()
	   .then((poll) => (poll == null)
		 ? next(new restify.NotFoundError())
		 : authorize(poll.accessLevel)(req, res, (err) => {
		     next.ifError(err);
		     poll.choices.forEach((choice) => delete choice.correct);
		     res.send(poll);
		     return next();
		 }))
	   .catch((err) => next(err))
	   .done());

server.put({ path: '/polls', version: '1.0.0' },
	   authorize(auth.level.PRIVILEDGED),
	   (req, res, next) => models.Poll.create(req.body)
	   .then((poll) => { res.send(poll); return next(); })
	   .catch((err) => next(restify.BadRequestError()))
	   .done());

server.del({ path: '/polls/:pollid', version: '1.0.0' },
	   authorize(auth.level.PRIVILEDGED),
	   (req, res, next) =>
	   models.Poll.remove({ _id: req.params.pollid })
	   .then((data) => { res.send(data); return next(); })
	   .catch((err) => next(restify.BadRequestError()))
	   .done());

server.post({ path: '/polls/:pollid', version: '1.0.0' },
	    authorize(auth.level.PRIVILEDGED),
	    (req, res, next) =>
	    models.Poll.findByIdAndUpdate(req.params.pollid,
					  { $set: req.body },
					  { new: true })
	    .exec()
	    .then((data) => { res.send(data); return next(); })
	    .catch((err) => next(restify.BadRequestError()))
	    .done());


/** Answer polls **/

function getAnswers(poll, req, next) {
    return (poll == null)
	? next(new restify.NotFoundError())
	: authorize(poll.accessLevel)(req, null, (err) => {
	    next.ifError(err);
	    return [poll, models.PollAnswers.aggregate()
		    .match({ user: req.user._id })
		    .unwind('answers')
		    .match({ 'answers.poll': poll._id })
		    .sort('answers.date')
		    .group({ _id: '$_id' ,
			     answers: { $push: '$answers' }
			   })
		    .exec()
		    .then((users) => users.length ? users[0] : null)
		   ];
	});
}

server.get({ path: '/answer/:pollid', version: '1.0.0' },
	   (req, res, next) => models.Poll.findById(req.params.pollid)
	   .exec()
	   .then((poll) => getAnswers(poll, req, next))
	   .spread((poll, user) => {
	       if (user) {
		   res.send({ poll: poll,
			      answers: user.answers.map((a) => ({
				  answer: a,
				  grade: poll.grade(a.choices)
			      }))
			    });
		   return next();
	       } else {
		   const pollObj = poll.toObject();
		   pollObj.choices.forEach((choice) => delete choice.correct);
		   return next(new restify.ForbiddenError({ body : {
		       message: 'Answer first',
		       poll: pollObj,
		   } }));
	       }
	   })
	   .catch((err) => next(err))
	   .done());

server.post({ path: '/answer/:pollid', version: '1.0.0' },
	    (req, res, next) => models.Poll.findById(req.params.pollid)
	    .exec()
	    .then((poll) => getAnswers(poll, req, next))
	    .spread((poll, user) => {
		const grade = poll.grade(req.body);
		const answer = { poll: poll, choices: req.body };
		return [poll, grade, models.PollAnswers.findOneAndUpdate(
		    { user: req.user._id },
		    { $push : { answers: answer } },
		    { new: true, upsert: true })]
	    })
	    .spread((poll, grade, result) => {
		res.send({ result: result, poll: poll, grade: grade });
		return next();
	    })
	    .catch((err) => err instanceof mongoose.Error.ValidationError
		   ? next(new restify.BadRequestError(err.message))
		   : next(err))
	    .done());

/** Stats **/

server.get({ path: '/stats/poll/:pollid', version: '1.0.0' }, (req, res, next) => {
});

function getUserAnswers(user) {
    return models.PollAnswers.aggregate()
	.match({ user: user })
	.unwind('answers')
	.sort('answers.date')
	.group({ _id: '$answers.poll', answers: { $push: '$answers' } })
	.exec()
	.then((polls) => Promise.all(
	    polls.map((p) => models.Poll.findById(p._id)
		      .then((poll) => null
			    ? null
			    : ({
				poll: poll,
				answers: p.answers.map((a) => ({
				    answer: a,
				    grade: poll.grade(a.choices)
				}))
			    })))
	));
}

server.get({ path: '/stats/user/:user', version: '1.0.0' }, 
	   authorize(auth.level.PRIVILEDGED),
	   (req, res, next) => getUserAnswers(req.params.user)
	   .then((answers) => {
	       res.send(answers);
	       next();
	   })
	   .catch((err) => next(err)));

server.get({ path: '/stats/me', version: '1.0.0' }, 
	   authorize(auth.level.USER),
	   (req, res, next) => getUserAnswers(req.user._id)
	   .then((answers) => {
	       res.send(answers);
	       next();
	   })
	   .catch((err) => next(err)));


/****/
server.listen(config.port || process.env.PORT || 8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});
