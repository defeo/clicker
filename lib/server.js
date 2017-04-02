const restify = require('restify');
const mongoose = require('mongoose');
const models = require('./models');

exports.createServer = function(opts) {
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

    /*
      The native authentication methods (anon, basic, bearer) use
      passport's default mechanism.
    */
    const auth = require('./auth');
    const passport = require('passport');
    server.use(passport.initialize());
    server.use(auth.auth);

    /*
      GitHub is handled specially: upon successful login, a bearer token is
      created and sent back to the client. This way the client can come
      back with the token for all succesive requests.
    */
    server.get({ path: '/login/github', version: '1.0.0' }, auth.ghCallback,
	       (req, res, next) => {
		   if (req.user) {
		       const token = auth.createToken(req.user._id, Date.now() + 20*1000);
		       return res.redirect(`${opts.clientURL}?token=${token.token}`, next);
		   } else {
		       return next(new restify.UnauthorizedError("You are not allowed to log in"));
		   }
	       });

    /* Middleware to check authorization level */
    function authorize(level) {
	return (req, res, next) => 
	    req.user.level < level
	    ? next(new restify.ForbiddenError()) 
	    : next();
    }

    /* Route to obtain a new token, with refreshed expiry date */
    server.get({ path: '/token', version: '1.0.0' },
	       authorize(auth.level.USER),
	       (req, res, next) => {
		   if (req.user) {
		       const token = auth.createToken(req.user._id);
		       res.send({
			   user: req.user.toObject(),
			   expires: token.expires,
			   token: token.token,
		       });
		       return next();
		   } else {
		       return next(new restify.UnauthorizedError("Authenticate first"));	
		   }
	       });

    /** Polls **/

    /* Validate Mongo ObjectIds for routes that have them */
    server.use((req, res, next) => {
	if (req.params.pollid &&
	    !mongoose.Types.ObjectId.isValid(req.params.pollid))
	    return next(new restify.NotFoundError());
	next();
    });
    
    /*
      Handler to get poll from db, handle common error cases, and pass on
      poll data in req.poll object.
    */
    function getPoll(req, res, next) {
	return models.Poll.findById(req.params.pollid)
	    .exec()
	    .then((poll) => {
		if (poll === null)
		    throw new restify.NotFoundError();
		const pollObj = poll.clean(req.user.level);
		if (pollObj === null)
		    throw new restify.ForbiddenError();
		req.poll = {
		    record: poll,
		    obj: pollObj,
		}
		next();
	    })
	    .catch((err) => next(err));
    }

    /* Get list of poll titles */
    server.get({ path: '/polls', version: '1.0.0' }, (req, res, next) => {
	models.Poll.find().select('_id title')
	    .lean().exec()
	    .then((doc) => { res.send(doc); return next(); })
	    .catch((err) => next(err));
    });

    /* 
       Get poll.

       Requires `read` authorization. Info on correct/wrong anwsers is
       stripped out, unless user also has `readAnswer` authorization.
    */
    server.get({ path: '/polls/:pollid', version: '1.1.0' },
	       getPoll,
	       (req, res, next) => {
		   res.send(req.poll.obj);
		   return next();
	       });

    /* Create poll. Only PRIVILEDGED users can create polls. */
    server.put({ path: '/polls', version: '1.0.0' },
	       authorize(auth.level.PRIVILEDGED),
	       (req, res, next) => models.Poll.create(req.body)
	       .then((poll) => { res.send(poll); return next(); })
	       .catch((err) => next(restify.BadRequestError())));

    /* Delete poll. Only PRIVILEDGED users can delete polls. */
    server.del({ path: '/polls/:pollid', version: '1.0.0' },
	       authorize(auth.level.PRIVILEDGED),
	       (req, res, next) =>
	       models.Poll.remove({ _id: req.params.pollid })
	       .then((data) => { res.send(data); return next(); })
	       .catch((err) => next(restify.BadRequestError())));

    /* Update poll. Only PRIVILEDGED users can update polls. */
    server.post({ path: '/polls/:pollid', version: '1.0.0' },
		authorize(auth.level.PRIVILEDGED),
		(req, res, next) =>
		models.Poll.findByIdAndUpdate(req.params.pollid,
					      { $set: req.body },
					      { new: true })
		.exec()
		.then((data) => { res.send(data); return next(); })
		.catch((err) => next(restify.BadRequestError())));


    /** Answer polls **/

    /*
      Get poll along with all anwsers given to poll by current user.

      Requires `read` authorization. If user has `readAnwser`
      authorization, also grades answers, otherwise strips out info on
      correct/wrong answer.
    */
    server.get({ path: '/answer/:pollid', version: '1.1.0' },
	       getPoll,
	       (req, res, next) => models.PollAnswers.aggregate()
	       .match({ user: req.user._id })
	       .unwind('answers')
	       .match({ 'answers.poll': req.poll.record._id })
	       .sort('answers.date')
	       .group({ _id: '$_id' ,
			answers: { $push: '$answers' }
		      })
	       .exec()
	       .then((users) => {
		   const canRead = req.poll.obj.can.readAnswer;
		   const answers = users.length
			 ? users[0].answers.map((a) => ({
			     answer: a,
			     grade: canRead ? req.poll.record.grade(a.choices) : null,
			 }))
			 : [];
		   res.send({ poll: req.poll.obj, answers: answers });
		   return next();
	       })
	       .catch((err) => next(err)));

    /*
      Add answer to poll.

      Requires `read` and `answer` authorizations. If `readAnswer` is
      authorized, also returns graded answer.
    */
    server.post({ path: '/answer/:pollid', version: '1.1.0' },
		getPoll,
		(req, res, next) => {
		    if (!req.poll.obj.can.answer)
			return next(new restify.ForbiddenError());
		    const answer = { poll: req.poll.record, choices: req.body };
		    return models.PollAnswers.findOneAndUpdate(
			{ user: req.user._id },
			{ $push : { answers: answer } },
			{ new: true, upsert: true })
			.then((result) => {
			    const grade = req.poll.obj.can.readAnswer
				  ? req.poll.record.grade(result.answers[result.answers.length-1].choices)
				  : null;
			    res.send({ result: result, poll: req.poll.obj, grade: grade });
			    return next();
			})
			.catch((err) => err instanceof mongoose.Error.ValidationError
			       ? next(new restify.BadRequestError(err.message))
			       : next(err));
		});

    /** Stats **/

    /*
      Get all answers by all users to poll.

      Requires `read` and `stat` authorization. If `readAnswer` is
      authorized, also grades each answer.
    */
    server.get({ path: '/stats/poll/:pollid', version: '1.0.0' },
	       getPoll,
	       (req, res, next) => {
		   if (!req.poll.obj.can.stat)
		       throw new restify.ForbiddenError();
		   models.PollAnswers.aggregate()
		       .match({ 'answers.poll' : req.poll.record._id })
		       .project({
			   user: '$user',
			   answers: { $filter: {
			       input: '$answers',
			       as: 'answ',
			       cond: { $eq: ['$$answ.poll', req.poll.record._id] }
			   } },
		       })
		       .exec()
		       .then((users) => {
			   const canRead = req.poll.obj.can.readAnswer;
			   res.send(users.map((u) => ({
			       user: u.user,
			       answers: u.answers.map((a) => ({
				   date: a.date,
				   choices: a.choices,
				   grade: canRead ? req.poll.record.grade(a.choices) : null,
			       }))
			   })));
			   return next();
		       })
		       .catch((err) => next(err));
	       });

    /* 
       Get list of answers by user, grouped by poll.
       
       For each poll, if `level` is enough for `readAnswer` authorization,
       the answers are graded.
    */
    function getUserAnswers(user, level) {
	return models.PollAnswers.aggregate()
	    .match({ user: user })
	    .unwind('answers')
	    .sort('answers.date')
	    .group({ _id: '$answers.poll', answers: { $push: '$answers' } })
	    .exec()
	    .then((polls) => Promise.all(
		polls.map((p) => models.Poll.findById(p._id)
			  .then((poll) => {
			      if (poll) {
				  const canRead = poll.can('readAnswer', level);
				  return {
				      poll: poll.clean(level),
				      answers: p.answers.map((a) => ({
					  answer: a,
					  grade: canRead ? poll.grade(a.choices) : null,
				      }))
				  };
			      } else {
				  return null;
			      }
			  }))))
	    .then((answers) => answers.filter((a) => a !== null));
    }

    /* 
       Gets all answers by a single user.

       Authentified user must have level >= PRIVILEDGED. Each answer is
       graded if authentified user has `readAnswer` authorization on the
       related poll.
    */
    server.get({ path: '/stats/user/:user', version: '1.0.0', name: 'stats-user' }, 
	       authorize(auth.level.PRIVILEDGED),
	       (req, res, next) => getUserAnswers(req.params.user, req.user.level)
	       .then((answers) => {
		   res.send(answers);
		   return next();
	       })
	       .catch((err) => next(err)));

    /* 
       Gets all answers by authentified user.

       Authentified user must have level >= USER. Each answer is graded if
       authentified user has `readAnswer` authorization on the related
       poll.
    */
    server.get({ path: '/stats/me', version: '1.0.0' }, 
	       authorize(auth.level.USER),
	       (req, res, next) => getUserAnswers(req.user._id, req.user.level)
	       .then((answers) => {
		   res.send(answers);
		   return next();
	       })
	       .catch((err) => next(err)));

    /** Users **/

    /*
      Get own profile
    */
    server.get({ path: '/profile', version: '1.0.0' },
	       (req, res, next) => {
		   res.send(req.user.profile);
		   return next();
	       });

    /*
      Update own profile

      Authentified user must have level >= USER.
    */
    server.post({ path: '/profile', version: '1.0.0' },
		authorize(auth.level.USER),
		(req, res, next) => {
		    let data = {};
		    if (req.body.name !== undefined)
			data['profile.name'] = req.body.name;
		    if (req.body.data !== undefined)
			data['profile.data'] = req.body.data;
		    return models.User.findByIdAndUpdate(req.user._id, { $set: data }, { new: true })
			.exec()
			.then((data) => { res.send(data.profile); return next(); })
			.catch((err) => next(restify.BadRequestError()))
		});

    /*
      Get list of all users

      The authenticated user must have level >= PRIVILEDGED.
    */
    server.get({ path: '/users', version: '1.0.0' }, 
	       authorize(auth.level.PRIVILEDGED),
	       (req, res, next) => models.User.find()
	       .lean().exec()
	       .then((list) => {
		   res.send(list);
		   return next();
	       })
	       .catch((err) => next(err)));

    return server;
}
