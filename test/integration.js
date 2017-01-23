const mongoose = require('mongoose');
const models = require('../lib/models');
const auth = require('../lib/auth');
const server = require('../lib/server').createServer();
server.on('InternalServer', function (req, res, err, next) {
    // TODO: does nothing
    console.log(err);
    return next();
});

const hippie = require('hippie');

function api(token) {
    const hip = hippie(server)
	  .header('Origin', 'example.com')
	  .json();
    return token ? hip.header('Authorization', `bearer ${token}`) : hip;
}

const adminTok = auth.createToken('admin').token;
const userTok = auth.createToken('user').token;

describe('Server', function() {
    before(function(done) {
	mongoose.connect('mongodb://localhost/testdb');
	models.User.create([
	    { _id: 'admin', level: auth.level.ADMIN },
	    { _id: 'user' }
	])
	    .then(() => done())
	    .catch(done);
    });

    it('CORS preflight', function(done) {
	api()
	    .method('OPTIONS')
            .header('Access-Control-Request-Method', 'POST')
	    .expectStatus(204)
	    .expectHeader('Access-Control-Allow-Origin', 'example.com')
            .expectHeader('Access-Control-Allow-Headers', 'authorization, content-type')
            .expectHeader('Allow', 'POST')
            .expectHeader('Access-Control-Allow-Methods', 'POST')
	    .end(done);
    });

    it('malformed pollid', function(done) {
	api()
	    .get('/polls/abc')
	    .expectStatus(404)
	    .end(done);
    });
    
    for (let [verb, route, token] of [
	['put', '/polls'],
	['post', '/polls/abcdefabcdef'],
	['del', '/polls/abcdefabcdef'],
	['get', '/stats/user/user'],
	['get', '/stats/me'],
	['get', '/users'],
	['get', '/stats/user/user', userTok],
	['get', '/users', userTok],
    ]) {
	it(`${verb} ${route} forbidden`, function(done) {
	    api(token)[verb](route)
		.expectStatus(403)
		.end(done);
	});
    }	    

    it('create poll', function(done) {
	api(adminTok)
	    .put('/polls')
	    .send({
		title: 'T',
		question: 'Q',
		choices: [
		    { answer: 'A1' },
		    { answer: 'A2', correct: false },
		    { answer: 'A3', correct: true }
		],
	    })
	    .expectStatus(200)
	    .expectValue('title', 'T')
	    .expectValue('question', 'Q')
	    .expectValue('multiChoice', false)
	    .expectValue('choices[0].answer', 'A1')
	    .expectValue('choices[1].answer', 'A2')
	    .expectValue('choices[2].answer', 'A3')
	    .expectValue('choices[0].correct', undefined)
	    .expectValue('choices[1].correct', false)
	    .expectValue('choices[2].correct', true)
	    .expectValue('auths.read[0].level', auth.level.ANONYMOUS)
	    .expectValue('auths.readAnswer[0].level', auth.level.PRIVILEDGED)
	    .expectValue('auths.answer[0].level', auth.level.USER)
	    .expectValue('auths.stat[0].level', auth.level.PRIVILEDGED)
	    .expect((res, body, next) => {
		this.poll = body;
		next();
	    })
	    .end(done);
    });

    it('list polls', function(done) {
	api()
	    .get('/polls')
	    .expectStatus(200)
	    .expectValue('[0].title', 'T')
	    .end(done);
    });
    
    it('modify poll', function(done) {
	api(adminTok)
	    .post(`/polls/${this.poll._id}`)
	    .send({ title: 'T1' })
	    .expectStatus(200)
	    .expectValue('title', 'T1')
	    .expectValue('question', 'Q')
	    .end(done);
    });

    it('get poll', function(done) {
	api()
	    .get(`/polls/${this.poll._id}`)
	    .expectStatus(200)
	    .expectValue('title', 'T1')
	    .expectValue('question', 'Q')
	    .expectValue('choices[1].correct', undefined)
	    .expectValue('choices[2].correct', undefined)
	    .end(done);
    });
    
    it('answer poll forbidden', function(done) {
	api()
	    .post(`/answer/${this.poll._id}`)
	    .send([])
	    .expectStatus(403)
	    .end(done);
    });

    it('answer poll', function(done) {
	api(userTok)
	    .post(`/answer/${this.poll._id}`)
	    .send([ this.poll.choices[0]._id ])
	    .expectStatus(200)
	    .expectValue('result.answers[0].choices', [ this.poll.choices[0]._id ])
	    .expectValue('poll.title', 'T1')
	    .expectValue('grade', null)
	    .end(done);
    });

    it('get answers', function(done) {
	api(userTok)
	    .get(`/answer/${this.poll._id}`)
	    .expectStatus(200)
	    .expectValue('poll.title', 'T1')
	    .expectValue('answers[0].answer.poll', this.poll._id)
	    .expectValue('answers[0].answer.choices', [ this.poll.choices[0]._id ])
	    .expectValue('answers[0].grade', null)
	    .end(done)
    });

    it('poll stats', function(done) {
	api(adminTok)
	    .get(`/stats/poll/${this.poll._id}`)
	    .expectStatus(200)
	    .expectValue('[0].user', 'user')
	    .expectValue('[0].answers[0].choices', [ this.poll.choices[0]._id ])
	    .expectValue('[0].answers[0].grade', { ok: false })
	    .end(done);
    });

    it('poll user', function(done) {
	api(adminTok)
	    .get(`/stats/user/user`)
	    .expectStatus(200)
	    .expectValue('[0].poll.title', 'T1')
	    .expectValue('[0].answers[0].answer.choices', [ this.poll.choices[0]._id ])
	    .expectValue('[0].answers[0].grade', { ok: false })
	    .end(done);
    });

    it('poll me', function(done) {
	api(userTok)
	    .get(`/stats/me`)
	    .expectStatus(200)
	    .expectValue('[0].poll.title', 'T1')
	    .expectValue('[0].answers[0].answer.choices', [ this.poll.choices[0]._id ])
	    .expectValue('[0].answers[0].grade', null)
	    .end(done);
    });

    it('user list', function(done) {
	api(adminTok)
	    .get(`/users`)
	    .expectStatus(200)
	    .expectValue('[0]._id', 'admin')
	    .expectValue('[0].level', auth.level.ADMIN)
	    .expectValue('[1]._id', 'user')
	    .expectValue('[1].level', auth.level.USER)
	    .end(done);
    });
    
    it('delete poll', function(done) {
	api(adminTok)
	    .del(`/polls/${this.poll._id}`)
	    .expectStatus(200)
	    .expectBody({ n: 1, ok: 1})
	    .end(done);
    });
    
    after(function(done) {
	mongoose.connection.db.dropDatabase(function(err) {
	    if (err) done(err);
	    else done();
	});
    });
});
