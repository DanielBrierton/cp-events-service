'use strict';

const API_BASE = 'https://www.eventbriteapi.com/v3';
const request = require('request');
const _ = require('loadash');
const countries = require('country-list')();

module.exports = function () {

    var seneca = this;
    var plugin = 'cd-eventbrite';

    seneca.add({role: plugin, cmd: 'eventCreatedHandler'}, webhookHandlers.eventCreated);
    seneca.add({role: plugin, cmd: 'syncEvent'}, syncEvent);
    seneca.add({role: plugin, cmd: 'getEvent'}, getEvent);
    seneca.add({role: plugin, cmd: 'createWebhook'}, createWebhook);

    var webhookHandlers = {
        eventCreated: function (webhookPayload) {
            var webhookId = webhookPayload.config.webhook_id;
            var url = webhookPayload.api_url + '?expand=venue,ticket_classes';
            return this.get(url)
                .then(function (event) {
                    return new Promise(function (resolve, reject) {
                        seneca.act({role: 'cd-dojos', cmd: 'find', query: {eventbriteWebhookId: webhookId}}, function (err, dojos) {
                            if (err) return reject(err);
                            resolve(dojos);
                        });
                    });
                })
                .then(function (dojos) {
                    return new Promise(function (resolve, reject) {
                        var resolved = false;
                        _.each(dojos, function (dojo) {
                            if (!resolved && event.description.text.match(dojo.slug)) {
                                resolve({
                                    dojo: dojo,
                                    event: event
                                });
                            }
                        });
                        if (!resolved) {
                            reject({err: 'Matching dojo not found'});
                        }
                    });
                })
                .then(syncEvent);
        }
    };

    function getEvent(args) {
        return this.get('/events/' + args.id + '/');
    }

    function createWebhook(args) {
        return this.post('/webhooks/', {
            endpoint_url: args.endpoint_url,
            actions: args.actions,
            event_id: args.event_id
        });
    }

    function syncEvent(args) {
        var dojo = args.dojo;
        var eventbriteEvent = args.event;
        return new Promise(function (resolve, reject) {
            seneca.act({plugin: 'cd-events', cmd: 'searchEvents', query: {eventbriteEventId: eventbriteEvent.id}}, function (err, zenEvents) {
                if (err) return reject(err);

                var status = 'saved';
                if (eventbriteEvent.status === 'canceled') { // 'canceled' is not a typo, that's how it's spelled in the DB...
                    status = 'cancelled';
                } else if (eventbriteEvent.listed && _.includes(['live', 'started', 'ended', 'completed'], eventbriteEvent.status)) {
                    status = 'published';
                }

                if (zenEvents.length === 0) {
                    seneca.act({plugin: 'cd-events', cmd: 'saveEvent', eventInfo: {
                        eventbriteEvent: true,
                        eventbriteEventUrl: eventbriteEvent.url,
                        eventbriteEventId: eventbriteEvent.id
                        name: eventbriteEvent.name.text,
                        description: eventbriteEvent.description.html,
                        createdAt: new Date(eventbriteEvent.created),
                        status: status,
                        position: {
                            lat: eventbriteEvent.venue.latitude,
                            lng: eventbriteEvent.venue.longitude
                        },
                        city: eventbriteEvent.venue.address.city,
                        address: addressToString(eventbriteEvent.venue.address),
                        type: 'one-off',
                        ticketApproval: false,
                        country: {
                            countryName: countries.getName(eventbriteEvent.venue.address.country),
                            alpha2: eventbriteEvent.venue.address.country
                        },
                        dojoId: dojo.id
                    }})
                } else {
                  // update event
                }
            });
        });
    }

    function addressToString(address) {
        var addressStr = '';
        if (address.address_1) addressStr += address.address_1 + ',\n';
        if (address.address_2) addressStr += address.address_2 + ',\n';
        if (address.city) addressStr += address.city + ',\n';
        if (address.region) addressStr += address.region + ',\n';
        if (address.postal_code) addressStr += address.postal_code + ',\n';
        return addressStr.substr(0, addressStr.length - 2); // Remove trailing comma and new line
    }

    function get(path) {
        return new Promise(function (resolve, reject) {
            var url = path.indexOf(API_BASE) === 0 ? path : (API_BASE + path);
            request.get(url)
                .on('error', reject)
                .on('response', resolve);
        });
    }

    function post(path, payload) {
        return new Promise(function (resolve, reject) {
            request.post(API_BASE + path)
                .form(payload)
                .on('error', reject)
                .on('response', resolve);
        });
    }
}
