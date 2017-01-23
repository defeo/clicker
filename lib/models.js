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
/* Check that the given level is authorized */
authSchema.methods.auth = function(level) {
    return (level >= this.level)
	&& (!this.before || new Date() <= this.before)
	&& (!this.after || new Date() >= this.after);
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
   authorizations for the given poll.
*/
exports.pollSchema.methods.can = function(action, level) {
    return this.auths[action].some((auth) => auth.auth(level));
}
/* Return poll as object, strip out unauthorized information */
exports.pollSchema.methods.clean = function(level) {
    if (undefined === level || this.can('read', level)) {
        const pollObj = this.toObject();
	if (undefined === level || !this.can('readAnswer', level)) {
            pollObj.choices.forEach((choice) => delete choice.correct);
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
exports.getOrCreateUser = (userid, next, create=true, lvl=level.USER) =>
    User.findById(userid).exec()
    .then((user) => {
	if (user) {
	    user.profile.lastSeen = Date.now();
	    return user.save();
	} else if (create) {
	    return User.create({ _id: userid, level: lvl });
	} else {
	    return user;
	}
    })
    .then((user) => next(null, user))
    .catch((err) => {console.log(err);next(err)});
