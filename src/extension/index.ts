'use strict';

// Packages
import * as cheerio from 'cheerio';
import * as RequestPromise from 'request-promise-native';

// Ours
import * as nodecgApiContext from './util/nodecg-api-context';

const request = RequestPromise.defaults({jar: true}); // <= Automatically saves and re-uses cookies.

let isFirstLogin = true;

module.exports = (nodecg: any) => {
	// Store a reference to this nodecg API context in a place where other libs can easily access it.
	// This must be done before any other files are `require`d.
	nodecgApiContext.set(nodecg);
	init().then(() => {
		nodecg.log.info('Initialization successful.');
	}).catch(error => {
		nodecg.log.error('Failed to initialize:', error);
	});
};

async function init() {
	const nodecg = nodecgApiContext.get();
	const TRACKER_CREDENTIALS_CONFIGURED = nodecg.bundleConfig.tracker.username &&
		nodecg.bundleConfig.tracker.password &&
		!nodecg.bundleConfig.useMockData;

	if (nodecg.bundleConfig.useMockData) {
		nodecg.log.warn('WARNING! useMockData is true, you will not receive real data from the tracker!');
	}

	// Fix zeit pkg being dumb.
	require('obs-websocket-js'); // tslint:disable-line:no-implicit-dependencies

	// Be careful when re-ordering these.
	// Some of them depend on Replicants initialized in others.
	require('./timekeeping');
	require('./obs');
	require('./nowplaying');
	require('./countdown');
	require('./sortable-list');
	require('./bingosync');
	require('./caspar');
	require('./intermissions');
	require('./setup-timer');

	if (TRACKER_CREDENTIALS_CONFIGURED) {
		await loginToTracker();

		// Tracker logins expire every 2 hours. Re-login every 90 minutes.
		setInterval(loginToTracker, 90 * 60 * 1000);
	} else {
		nodecg.log.warn('Tracker credentials not defined in cfg/agdq19-layouts.json; will be unable to access privileged data.');
	}

	const schedule = require('./schedule');
	if (TRACKER_CREDENTIALS_CONFIGURED) {
		schedule.on('permissionDenied', () => {
			loginToTracker().then(schedule.update);
		});
	}

	require('./bids');
	require('./prizes');
	require('./total');

	if (nodecg.bundleConfig.twitch) {
		require('./twitch-ads');
		require('./twitch-pubsub');

		// If the appropriate config params are present,
		// automatically update the Twitch game and title when currentRun changes.
		if (nodecg.bundleConfig.twitch.titleTemplate) {
			nodecg.log.info('Automatic Twitch stream title updating enabled.');
			require('./twitch-title-updater');
		}
	}

	if (nodecg.bundleConfig.twitter) {
		if (nodecg.bundleConfig.twitter.enabled) {
			require('./twitter');
		}
	} else {
		nodecg.log.warn('"twitter" is not defined in cfg/agdq19-layouts.json! ' +
			'Twitter integration will be disabled.');
	}

	if (nodecg.bundleConfig.victorOps && nodecg.bundleConfig.victorOps.apiId && nodecg.bundleConfig.victorOps.apiKey) {
		if (nodecg.bundleConfig.victorOps.enabled) {
			require('./victor-ops');
		}
	} else {
		nodecg.log.warn('"victorOps" is not defined in cfg/agdq19-layouts.json! ' +
			'VictorOps integration will be disabled.');
	}

	if (nodecg.bundleConfig.mixer && nodecg.bundleConfig.mixer.address) {
		require('./mixer');
	} else {
		nodecg.log.warn('"mixer" is not defined in cfg/agdq19-layouts.json! ' +
			'Behringer X32 OSC integration will be disabled.');
	}

	if (nodecg.bundleConfig.firebase && Object.keys(nodecg.bundleConfig.firebase).length > 0) {
		require('./interview');
	} else {
		nodecg.log.warn('"firebase" is not defined in cfg/agdq19-layouts.json! ' +
			'The interview question system (Lightning Round) will be disabled.');
	}

	if (nodecg.bundleConfig.zabbix && nodecg.bundleConfig.zabbix.enabled) {
		require('./zabbix');
	}
}

// Fetch the login page, and run the response body through cheerio
// so we can extract the CSRF token from the hidden input field.
// Then, POST with our username, password, and the csrfmiddlewaretoken.
async function loginToTracker() {
	const {GDQUrls} = require('./urls');
	const nodecg = nodecgApiContext.get();
	const loginLog = new nodecg.Logger(`${nodecg.bundleName}:tracker`);

	if (isFirstLogin) {
		loginLog.info('Logging in as %s...', nodecg.bundleConfig.tracker.username);
	} else {
		loginLog.info('Refreshing tracker login session as %s...', nodecg.bundleConfig.tracker.username);
	}

	return request({
		uri: GDQUrls.login,
		transform(body) {
			return cheerio.load(body);
		}
	}).then($ => request({
		method: 'POST',
		uri: GDQUrls.login,
		form: {
			username: nodecg.bundleConfig.tracker.username,
			password: nodecg.bundleConfig.tracker.password,
			csrfmiddlewaretoken: $('#login-form > input[name="csrfmiddlewaretoken"]').val()
		},
		headers: {
			Referer: GDQUrls.login
		},
		resolveWithFullResponse: true,
		simple: false
	})).then(() => {
		if (isFirstLogin) {
			isFirstLogin = false;
			loginLog.info('Logged in as %s.', nodecg.bundleConfig.tracker.username);
		} else {
			loginLog.info('Refreshed session as %s.', nodecg.bundleConfig.tracker.username);
		}
	}).catch(err => {
		loginLog.error('Error authenticating!\n', err);
	});
}
