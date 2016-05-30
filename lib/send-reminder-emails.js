var async = require('async');
var moment = require('moment');
var _ = require('lodash');

module.exports = function () {
  var seneca = this;

  return function () {
    var eventIds = [];
    var userIds = [];
    var dojoIds = [];
    var eventApplications = [];
    var userIdMap = {};
    var dojoIdMap = {};
    var parentIdMap = {};
    var now = new Date();

    async.waterfall([
      populateEventApplications,
      populateUserIdMap,
      populateDojoIdMap,
      populateParentIdMap,
      sendEmails,
      updateLastReminderTime
    ], function (err, res) {
      if (err) console.error(err.message);
    });

    function populateEventApplications(cb) {
      var entity = seneca.make();
      entity.native$(function (err, client) {
        var query = "SELECT * FROM (" +
                      "SELECT cd_events.*, cd_applications.user_id, (unnest(dates)->>'reminderTime')::timestamp reminderTime, (unnest(dates)->>'startTime')::timestamp startTime " +
                      "FROM cd_events INNER JOIN cd_applications on cd_applications.event_id=cd_events.id " +
                      "WHERE cd_applications.status='approved'" +
                    ") x WHERE reminderTime < now() AND (reminderTime > last_reminder_time OR last_reminder_time IS NULL);";
        client.query(query, [], function (err, result) {
          client.end();
          if(err) {
            return console.error('error running query', err);
          }
          eventApplications = result.rows;
          _.each(result.rows, function (eventApplications) {
            if (eventIds.indexOf(eventApplications.id) === -1) {
              eventIds.push(eventApplications.id);
            }
            if (userIds.indexOf(eventApplications.user_id) === -1) {
              userIds.push(eventApplications.user_id);
            }
            if (dojoIds.indexOf(eventApplications.dojo_id) === -1) {
              dojoIds.push(eventApplications.dojo_id);
            }
          });
          cb();
        });
      });
    }

    function populateUserIdMap(cb) {
      seneca.act({cmd: 'get_users_by_user_ids', role: 'cd-users', user_id: userIds}, function(err, users) {
        _.each(users, function (user) {
          userIdMap[user.user_id] = user;
        });
        cb();
      });
    }

    function populateDojoIdMap(cb) {
      seneca.act({cmd: 'dojos_by_dojo_ids', role: 'cd-dojos', dojo_id: dojoIds}, function (err, dojos) {
        _.each(dojos, function (dojo) {
          dojoIdMap[dojo.id] = dojo;
        });
        cb();
      });
    }

    function populateParentIdMap(cb) {
      var parentIds = [];
      for (var userId in userIdMap) {
        var user = userIdMap[userId];
        if (!user.email && user.parents && user.parents.length > 0) {
          _.each(user.parents, function (parentId) {
            if (parentIds.indexOf(parentId) === -1) {
              parentIds.push(parentId);
            }
          })
        }
      }
      seneca.act({cmd: 'get_users_by_user_ids', role: 'cd-users', user_id: parentIds}, function (err, parents) {
        _.each(parents, function (parent) {
          parentIdMap[parent.user_id] = parent;
        });
        cb();
      });
    }

    function sendEmails(cb) {
      _.each(eventApplications, function (eventApplication) {
        var dojo = dojoIdMap[eventApplication.dojo_id];
        var user = userIdMap[eventApplication.user_id];
        var event = eventApplication;

        var content = {
          // TODO: figure out how to get zenHostname here so we can put together a link
          dojo: {
            name: dojo.name,
            email: dojo.email
          },
          event: {},
          year: moment(new Date()).format('YYYY')
        };

        var code = '';
        var baseCode = 'remind-all-attendees-';
        var startDateUtcOffset = moment(_.head(event.dates).startTime).utcOffset();
        var endDateUtcOffset = moment(_.head(event.dates).endTime).utcOffset();

        var startDate = moment.utc(_.head(event.dates).startTime).subtract(startDateUtcOffset, 'minutes').toDate();
        var endDate = moment.utc(_.head(event.dates).endTime).subtract(endDateUtcOffset, 'minutes').toDate();

        content.event.date = moment(startDate).format('Do MMMM YY') + ', ' +
          moment(startDate).format('HH:mm') + ' - ' +
          moment(endDate).format('HH:mm');
        var locality = 'en_US';
        emailSubject = 'Event Reminder - ' + dojo.name;

        content.dojoMember = user.name;
        var email = user.email;
        code = baseCode;
        if (!user.email && user.parents && user.parents.length > 0) {
          var parent = parentIdMap[user.parents[0]];
          email = parent.email;
          code = 'parents-' + baseCode;
          content.childrenName = user.name;
          content.dojoMember = parent.name;
        }
        if (!_.isEmpty(email)) {
          var payload = {replyTo: dojo.email, from: dojo.name + ' <' + dojo.email + '>', to: email,
            code: code, locality: locality, content: content, subject: emailSubject};
          seneca.act({role: 'cd-dojos', cmd: 'send_email', payload: _.cloneDeep(payload)});
        }
      });
      cb();
    }

    function updateLastReminderTime(cb) {
      var entity = seneca.make('cd_events');
      entity.native$(function (err, client) {
        client.query("UPDATE cd_events SET last_reminder_time=$1 WHERE id IN ('" + eventIds.join("','") + "')", [now.toISOString()], function (err) {
          if(err) {
            return console.error('error running query', err);
          }
        })
      });
    }
  }
};