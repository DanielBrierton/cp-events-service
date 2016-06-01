var async = require('async');
var moment = require('moment');
var _ = require('lodash');

module.exports = function (seneca) {

  return function () {
    var now = new Date();

    async.waterfall([
      populateEventApplications,
      populateUserIdMap,
      populateDojoIdMap,
      populateParentIdMap,
      sendEmails,
      updateLastReminderTime
    ], function (err, res) {
      if (err && err.message) console.error(err.message);
    });

    function populateEventApplications(cb) {
      var data = {};
      data.eventIds = data.eventIds || [];
      data.userIds = data.userIds || [];
      data.dojoIds = data.dojoIds || [];
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
          data.eventApplications = result.rows;
          if (result.rows.length === 0) {
            cb({});
          } else {
            _.each(result.rows, function (eventApplication) {
              if (data.eventIds.indexOf(eventApplication.id) === -1) {
                data.eventIds.push(eventApplication.id);
              }
              if (data.userIds.indexOf(eventApplication.user_id) === -1) {
                data.userIds.push(eventApplication.user_id);
              }
              if (data.dojoIds.indexOf(eventApplication.dojo_id) === -1) {
                data.dojoIds.push(eventApplication.dojo_id);
              }
            });
            cb(null, data);
          }
        });
      });
    }

    function populateUserIdMap(data, cb) {
      data.userIdMap = data.userIdMap || {};
      seneca.act({cmd: 'list', role: 'cd-profiles', query: { user_id: {in$: data.userIds}} }, function(err, users) {
        if (users.length === 0) {
          cb({});
        } else {
          _.each(users, function (user) {
            data.userIdMap[user.userId] = user;
          });
          cb(null, data);
        }
      });
    }

    function populateDojoIdMap(data, cb) {
      data.dojoIdMap = data.dojoIdMap || {};
      seneca.act({cmd: 'list', role: 'cd-dojos', query: { id: {in$: data.dojoIds} }}, function (err, dojos) {
        if (dojos.length === 0) {
          cb({});
        } else {
          _.each(dojos, function (dojo) {
            data.dojoIdMap[dojo.id] = dojo;
          });
          cb(null, data);
        }
      });
    }

    function populateParentIdMap(data, cb) {
      data.parentIds = data.parentIds || [];
      data.parentIdMap = data.parentIdMap || {};
      var parentIds = [];
      for (var userId in data.userIdMap) {
        var user = data.userIdMap[userId];
        if (!user.email && user.parents && user.parents.length > 0) {
          _.each(user.parents, function (parentId) {
            if (data.parentIds.indexOf(parentId) === -1) {
              data.parentIds.push(parentId);
            }
          })
        }
      }
      seneca.act({cmd: 'list', role: 'cd-users', ids: data.parentIds}, function (err, parents) {
        _.each(parents, function (parent) {
          data.parentIdMap[parent.id] = parent;
        });
        cb(null, data);
      });
    }

    function sendEmails(data, cb) {
      _.each(data.eventApplications, function (event) {
        var dojo = data.dojoIdMap[event.dojo_id];
        var user = data.userIdMap[event.user_id];

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
        var code = 'remind-all-attendees-';
        var startDateUtcOffset = moment(_.head(event.dates).startTime).utcOffset();
        var endDateUtcOffset = moment(_.head(event.dates).endTime).utcOffset();

        var startDate = moment.utc(_.head(event.dates).startTime).subtract(startDateUtcOffset, 'minutes').toDate();
        var endDate = moment.utc(_.head(event.dates).endTime).subtract(endDateUtcOffset, 'minutes').toDate();

        content.event.date = moment(startDate).format('Do MMMM YY') + ', ' +
          moment(startDate).format('HH:mm') + ' - ' +
          moment(endDate).format('HH:mm');
        emailSubject = 'Event Reminder - ' + dojo.name;

        content.dojoMember = user.name;
        var email = user.email;
        console.log(user.parent);
        if (!user.email && user.parents && user.parents.length > 0) {
          var parent = data.parentIdMap[user.parents[0]];
          console.log(parent);
          email = parent.email;
          code = 'parents-' + code;
          content.childrenName = user.name;
          content.dojoMember = parent.name;
        }
        if (!_.isEmpty(email)) {
          var payload = {replyTo: dojo.email, from: dojo.name + ' <' + dojo.email + '>', to: email,
            code: code, locality: dojo.locality || 'en_US', content: content, subject: emailSubject};
          seneca.act({role: 'cd-dojos', cmd: 'send_email', payload: _.cloneDeep(payload)});
        }
      });
      cb(null, data);
    }

    function updateLastReminderTime(data, cb) {
      var entity = seneca.make('cd_events');
      seneca.act({role: 'cd-events', cmd: 'listEvents', query: {id: {in$: data.eventIds}}}, function (err, events) {
        if (err) return cb(err);
        _.each(events, function (event) {
          event.lastReminderTime = now.toISOString();
          event.save$(function (err, entity) {
            if (err) return cb(err);
          });
        });
      });
    }
  }
};