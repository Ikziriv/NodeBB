'use strict';

var async = require('async');

var db = require('../database');
var user = require('../user');
var meta = require('../meta');
var topics = require('../topics');
var socketHelpers = require('../socket.io/helpers');

module.exports = function (Posts) {
	Posts.shouldQueue = function (uid, data, callback) {
		async.waterfall([
			function (next) {
				user.getUserFields(uid, ['reputation', 'postcount'], next);
			},
			function (userData, next) {
				var shouldQueue = !parseInt(uid, 10) || (parseInt(meta.config.postQueue, 10) === 1 && parseInt(userData.reputation, 10) <= 0 && parseInt(userData.postcount, 10) <= 0);
				next(null, shouldQueue);
			},
		], callback);
	};

	Posts.addToQueue = function (data, callback) {
		var type = data.title ? 'topic' : 'post';
		var id = type + '-' + Date.now();
		async.waterfall([
			function (next) {
				db.sortedSetAdd('post:queue', Date.now(), id, next);
			},
			function (next) {
				db.setObject('post:queue:' + id, {
					id: id,
					uid: data.uid,
					type: type,
					data: JSON.stringify(data),
				}, next);
			},
			function (next) {
				next(null, {
					queued: true,
					message: '[[success:post-queued]]',
				});
			},
		], callback);
	};

	Posts.removeFromQueue = function (id, callback) {
		async.waterfall([
			function (next) {
				db.sortedSetRemove('post:queue', id, next);
			},
			function (next) {
				db.delete('post:queue:' + id, next);
			},
		], callback);
	};

	Posts.submitFromQueue = function (id, callback) {
		async.waterfall([
			function (next) {
				db.getObject('post:queue:' + id, next);
			},
			function (data, next) {
				if (!data) {
					return callback();
				}
				try {
					data.data = JSON.parse(data.data);
				} catch (err) {
					return next(err);
				}

				if (data.type === 'topic') {
					createTopic(data.data, next);
				} else if (data.type === 'post') {
					createPost(data.data, next);
				}
			},
			function (next) {
				Posts.removeFromQueue(id, next);
			},
		], callback);
	};

	function createTopic(data, callback) {
		async.waterfall([
			function (next) {
				topics.post(data, next);
			},
			function (result, next) {
				socketHelpers.notifyNew(data.uid, 'newTopic', { posts: [result.postData], topic: result.topicData });
				next();
			},
		], callback);
	}

	function createPost(data, callback) {
		async.waterfall([
			function (next) {
				topics.reply(data, next);
			},
			function (postData, next) {
				var result = {
					posts: [postData],
					'reputation:disabled': parseInt(meta.config['reputation:disabled'], 10) === 1,
					'downvote:disabled': parseInt(meta.config['downvote:disabled'], 10) === 1,
				};
				socketHelpers.notifyNew(data.uid, 'newPost', result);
				next();
			},
		], callback);
	}
};