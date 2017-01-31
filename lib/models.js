const mongoose =  require('mongoose');
mongoose.Promise = Promise;
const Schema = mongoose.Schema;
const level = require('./auth').level;
const _ = require('lodash');

/* Produce an auth level scheme with given default value */
function Level(defaults) {
    return { type: Number, min: level.ANONYMOUS, default: defaults }
}

/*
  The schema of an authorization.

  An authorization is made of a minimal level, and optional before and
  after dates.

  A user is authorized only if his level is >= the minimal level, and
  the current date is between after and before.
*/
const authSchema = new Schema({
    level: Level(level.USER),
    before: Date,
    after: Date,
});
/* 
   Check that the given level is authorized.

   If not authorized returns `false`. If authorized, returns the
   authorization expiry date, if any, or true.
*/
authSchema.methods.auth = function(level) {
    return ((level >= this.level)
	    && (!this.before || new Date() <= this.before)
	    && (!this.after || new Date() >= this.after))
	? this.before || true
	: false;
}
    
/* The schema of answers to a poll */
const answerSchema = new Schema({
    answer: { type: String, required: true },
    correct: Boolean,
});

/* The schema for a poll */
exports.pollSchema = new Schema({
    title: String,
    question: String,
    multiChoice: { type: Boolean, default: false },
    choices: [ answerSchema ],
    auths: {
	read: { type: [authSchema], default: [{ level: level.ANONYMOUS }] },
	readAnswer: { type: [authSchema], default: [{ level: level.PRIVILEDGED }] },
	answer: { type: [authSchema], default: [{ level: level.USER }] },
	stat: { type: [authSchema], default: [{ level: level.PRIVILEDGED }] },
    }
});
/*
  Grade an answer to this poll.

  `answers` is a list of answer ids (strings), its length must be
  exactly 1, unless the poll is a `multiChoice`.
*/
exports.pollSchema.methods.grade = function(answers) {
    if (!(answers instanceof Array))
	throw new mongoose.Error.ValidationError();
    const answ = answers.map((x) => x.toString());
    if (!this.multiChoice) {
	if (answ.length != 1)
	    throw new mongoose.Error.ValidationError();
	const choice = this.choices.find((c) => c._id == answ[0]) || false;
	return { ok: choice && Boolean(choice.correct) };
    } else {
	const group = _.countBy(answ, _.identity);
	const grade = this.choices.reduce(((grade, c) =>
					   grade + (c._id in group
						    ? group[c._id]-- && Boolean(c.correct)
						    : !c.correct)
					  ), 0);
	if (_.sum(_.values(group)) > 0)
	    throw new mongoose.Error.ValidationError();
	return { ok: grade, on: this.choices.length };
    }
}
/* 
   Check if an action is authorized for the given level.
   
   A level is authorized if it matches at least one of the
   authorizations for the given poll. If level is authorized, 
*/
exports.pollSchema.methods.can = function(action, level) {
    // Relies on (false < new Date()) === true
    return this.auths[action].map((auth) => auth.auth(level)).reduce(
	(max, next) => max === true ? max : next === true ? next : max < next ? next : max,
	false);
}
/* 
   Return poll as object, strip out unauthorized information, 
   add info on authorized actions.
*/
exports.pollSchema.methods.clean = function(lvl=level.ANONYMOUS) {
    if (this.can('read', lvl)) {
        const pollObj = this.toObject();
	if (!this.can('readAnswer', lvl)) {
            pollObj.choices.forEach((choice) => delete choice.correct);
	}
	pollObj.can = {};
	for (let action in pollObj.auths) {
	    pollObj.can[action] = this.can(action, lvl);
	}
	return pollObj;
    } else {
	return null;
    }
}
const Poll = exports.Poll = mongoose.model('Poll', exports.pollSchema);

/* The schema for a user profile */
const profileSchema = new Schema({
    created: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    name: String,
});

/* The schema for a user */
exports.userSchema = new Schema({
    _id: String,
    level: Level(level.USER),
    profile: { type: profileSchema, default: {} }
});
const User = exports.User = mongoose.model('User', exports.userSchema);

/* The schema for a user's anwsers */
exports.pollAnswersSchema = new Schema({
    user: { type: String, unique: true, ref: 'User' },
    answers: [{
	poll: { type: Schema.Types.ObjectId, ref: 'Poll' },
	choices: [{ type: Schema.Types.ObjectId }],
	date: { type: Date, default: Date.now },
    }],
});
const PollAnswers = exports.PollAnswers = mongoose.model('PollAnswers', exports.pollAnswersSchema);

/*
  Utility function to get or create a user.

  `next(error, user)` is a callback function.

  If `create` is true (default), it always passes a user (or an error)
  to `next`. If it is false, it may pass `user=null` if the user does
  not exist.
*/
exports.getOrCreateUser = (userid, next, create=true, lvl=level.USER, profile={}) =>
    User.findById(userid).exec()
    .then((user) => {
	if (user) {
	    user.profile.lastSeen = Date.now();
	    return user.save();
	} else if (create) {
	    return User.create({ _id: userid, level: lvl, profile: profile });
	} else {
	    return false;
	}
    })
    .then((user) => next(null, user))
    .catch((err) => next(err));
