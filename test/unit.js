const assert = require('assert');
const mongoose = require('mongoose');
const models = require('../lib/models');
const auth = require('../lib/auth');
const level = auth.level;

describe('Models', function() {
    before(function() {
	this.admin = new models.User({ _id: 'admin:',
				       level: level.ADMIN,
				     });
	this.user = new models.User({ _id: 'user:',
				      profile: { name: 'Pinco Pallino' },
				     });
    });
    
    it('dates should be set automatically', function() {
	assert(this.admin.profile.created <= this.admin.profile.lastSeen <= Date.now());
    });
    
    it('default level is USER', function() {
	assert.equal(this.user.level, level.USER);
    });
    
    it('poll default auths', function() {
	const poll = new models.Poll({});
	for (var action of ['read', 'answer'])
	    assert(poll.can(action, this.user.level));
	for (var action of ['readAnswer', 'stat'])
	    assert(!poll.can(action, this.user.level));
	for (var action of ['read', 'readAnswer', 'answer', 'stat'])
	    assert(poll.can(action, this.admin.level));
    });
    
    it('poll advanced auths', function(done) {
	const poll = new models.Poll({ auths: {
	    read: [ { before: Date.now() }, { level: level.PRIVILEDGED } ],
	    readAnswer: [ { before: Date.now() + 100, after: Date.now() } ],
	    answer: [],
	    stat: [ { after: Date.now() + 100 } ],
	} });
	assert(poll.can('readAnswer', this.user.level));
	for (var action of ['read', 'answer', 'stat'])
	    assert(!poll.can(action, this.user.level));
	for (var action of ['read', 'readAnswer'])
	    assert(poll.can(action, this.admin.level));
	for (var action of ['answer', 'stat'])
	    assert(!poll.can(action, this.admin.level));
	setTimeout(() => {
	    assert(poll.can('stat', this.user.level));
	    assert(poll.can('stat', this.admin.level));
	    assert(!poll.can('readAnswer', this.user.level));
	    assert(!poll.can('readAnswer', this.admin.level));
	    done();
	}, 110);
    });
    it('cleans answers if not authorized', function() {
	const poll = new models.Poll({
	    choices: [
		{ answer: 'A1' },
		{ answer: 'A2', correct: false },
		{ answer: 'A3', correct: true },
	    ],
	    auths: { read: { level: level.USER } },
	});
	assert.equal(poll.clean(), null);
	assert.equal(poll.clean(level.ANONYMOUS), null);
	for (var c of poll.clean(this.user.level).choices)
	    assert.deepEqual(Object.keys(c).sort(), ['_id', 'answer']);
	assert.deepEqual(poll.clean(this.admin.level).choices,
			 poll.choices.toObject());
    });
    it('grades single choice answers', function() {
	const poll = new models.Poll({
	    multiChoice: false,
	    choices: [
		{ answer: 'A1' },
		{ answer: 'A2', correct: false },
		{ answer: 'A3', correct: true },
	    ],
	});
	assert.deepEqual(poll.grade([poll.choices[0]._id]), { ok: false });
	assert.deepEqual(poll.grade([poll.choices[1]._id]), { ok: false });
	assert.deepEqual(poll.grade([poll.choices[2]._id]), { ok: true });
	assert.deepEqual(poll.grade(['toto']), { ok: false });
	assert.throws(() => poll.grade(['a', 'b']), mongoose.Error.ValidationError);
    });
    
    it('grades multiple choice answers', function() {
	const poll = new models.Poll({
	    multiChoice: true,
	    choices: [
		{ answer: 'A1' },
		{ answer: 'A2', correct: false },
		{ answer: 'A3', correct: true },
	    ],
	});
	assert.deepEqual(poll.grade([]), { ok: 2, on: 3 });
	assert.deepEqual(poll.grade([poll.choices[2]._id]), { ok: 3, on: 3 });
	assert.deepEqual(poll.grade([poll.choices[0]._id, poll.choices[1]._id]),
			 { ok: 0, on: 3 });
	assert.deepEqual(poll.grade([poll.choices[0]._id,
				     poll.choices[1]._id,
				     poll.choices[2]._id]),
			 { ok: 1, on: 3 });
	assert.throws(() => poll.grade(['toto']), mongoose.Error.ValidationError);
	assert.throws(() => poll.grade([poll.choices[2]._id, poll.choices[2]._id]),
		      mongoose.Error.ValidationError);
    });
});

describe('Auth', function() {
    it('#createToken', function() {
	assert.deepEqual(auth.createToken({ a: 1 }, 1000, 'sha256', 'abcde'),
			 {
			     data: { a: 1 },
			     expires: 1000,
			     token: 'eyJkYXRhIjp7ImEiOjF9LCJleHBpcmVzIjoxMDAwfQ==|vsa8uN3HO2UdKtVtN2HwsdGUhCTGnskqZWtLEA7hPmg=',
			 });
    });
    it('#decodeToken', function(done) {
	const tok = auth.createToken({ a: 1 }, Date.now() + 100, 'sha256', 'abcde');
	assert.deepEqual(auth.decodeToken(tok.token, 'sha256', 'abcde'),
			 { data: { a: 1 }, expires: tok.expires });
	assert.throws(() => auth.decodeToken('', 'sha256', 'abcde'),
		      /Invalid token/);
	assert.throws(() => auth.decodeToken(tok.token.replace(/|./, '|'), 'sha256', 'abcde'),
		      /Invalid token/);
	setTimeout(function() {
	    assert.throws(() => auth.decodeToken(tok.token, 'sha256', 'abcde'),
			  /Token expired/);
	    done();
	}, 110);
    });
});
