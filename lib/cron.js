var schedule = require('node-schedule');
var _ = require('lodash');

module.exports = function () {
  var seneca = this;
  var jobs = [{
    schedule: '0,30 * * * *',
    callback: require('./send-reminder-emails').call(seneca)
  }];

  _.each(jobs, function (job) {
    schedule.scheduleJob(job.schedule, job.callback);
  });
};