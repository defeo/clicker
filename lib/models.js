const mongoose =  require('mongoose');
const Promise = mongoose.Promise = require('bluebird');
const Schema = mongoose.Schema;
const level = require('./auth').level;
const _ = require('lodash');

function Level(defaults) {
    return { type: Number, min: level.ANONYMOUS, default: defaults }
}

const answerSchema = new Schema({
    answer: { type: String, required: true },
    correct: Boolean,
});

exports.pollSchema = new Schema({
    title: String,
    question: String,
    multiChoice: { type: Boolean, default: false },
    choices: [ answerSchema ],
    accessLevel: Level(level.USER),
    statLevel: Level(level.PRIVILEDGED),
});
exports.pollSchema.methods.grade = function(answers) {
    if (!(answers instanceof Array))
	throw new mongoose.Error.ValidationError();
    const answ = answers.map((x) => x.toString());
    if (!this.multiChoice) {
	if (answ.length != 1)
	    throw new mongoose.Error.ValidationError();
	const choice = this.choices.find((c) => c._id == answ[0]) || false;
	return { ok: choice && choice.correct };
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
const Poll = exports.Poll = mongoose.model('Poll', exports.pollSchema);

exports.userSchema = new Schema({
    _id: String,
    level: Level(level.USER),
    lastSeen: { type: Date, default: Date.now },    
});
const User = exports.User = mongoose.model('User', exports.userSchema);

exports.pollAnswersSchema = new Schema({
    user: { type: String, unique: true, ref: 'User' },
    answers: [{
	poll: { type: Schema.Types.ObjectId, ref: 'Poll' },
	choices: [{ type: Schema.Types.ObjectId }],
	date: { type: Date, default: Date.now },
    }],
});
const PollAnswers = exports.PollAnswers = mongoose.model('PollAnswers', exports.pollAnswersSchema);

exports.getOrCreateUser = (userid, next, create=true) =>
    User.findById(userid).exec()
    .then((user) => {
	if (user) {
	    user.lastSeen = Date.now();
	    user.save();
	    return user;
	} else if (create) {
	    user = new User({ _id: userid });
	    user.save();
	    return user;
	} else {
	    return user;
	}
    })
    .then((user) => next(null, user))
    .catch((err)  => next(err))
    .done();
