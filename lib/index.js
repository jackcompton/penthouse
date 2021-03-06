'use strict';

let browserIsRunning = (() => {
  var _ref2 = _asyncToGenerator(function* () {
    try {
      // will throw 'Not opened' error if browser is not running
      yield browser.version();
      return true;
    } catch (e) {
      return false;
    }
  });

  return function browserIsRunning() {
    return _ref2.apply(this, arguments);
  };
})();

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _puppeteer = require('puppeteer');

var _puppeteer2 = _interopRequireDefault(_puppeteer);

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _core = require('./core');

var _core2 = _interopRequireDefault(_core);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const debuglog = (0, _debug2.default)('penthouse');

const DEFAULT_VIEWPORT_WIDTH = 1300; // px
const DEFAULT_VIEWPORT_HEIGHT = 900; // px
const DEFAULT_TIMEOUT = 30000; // ms
const DEFAULT_MAX_EMBEDDED_BASE64_LENGTH = 1000; // chars
const DEFAULT_USER_AGENT = 'Penthouse Critical Path CSS Generator';
const DEFAULT_RENDER_WAIT_TIMEOUT = 100;
const DEFAULT_BLOCK_JS_REQUESTS = true;
const DEFAULT_PROPERTIES_TO_REMOVE = ['(.*)transition(.*)', 'cursor', 'pointer-events', '(-webkit-)?tap-highlight-color', '(.*)user-select'];

function exitHandler() {
  if (browser && browser.close) {
    browser.close();
    browser = null;
  }
  process.exit(0);
}

// shared between penthouse calls
let browser = null;
let _browserLaunchPromise = null;
// browser.pages is not implemented, so need to count myself to not close browser
// until all pages used by penthouse are closed (i.e. individual calls are done)
let _browserPagesOpen = 0;
const launchBrowserIfNeeded = (() => {
  var _ref = _asyncToGenerator(function* ({ getBrowser }) {
    if (browser) {
      return;
    }
    if (getBrowser && typeof getBrowser === 'function') {
      _browserLaunchPromise = Promise.resolve(getBrowser());
    }
    if (!_browserLaunchPromise) {
      debuglog('no browser instance, launching new browser..');
      _browserLaunchPromise = _puppeteer2.default.launch({
        ignoreHTTPSErrors: true,
        args: ['--disable-setuid-sandbox', '--no-sandbox']
      }).then(function (browser) {
        debuglog('new browser launched');
        return browser;
      });
    }
    browser = yield _browserLaunchPromise;
    _browserLaunchPromise = null;
  });

  return function launchBrowserIfNeeded(_x) {
    return _ref.apply(this, arguments);
  };
})();

function readFilePromise(filepath, encoding) {
  return new Promise((resolve, reject) => {
    _fs2.default.readFile(filepath, encoding, (err, content) => {
      if (err) {
        return reject(err);
      }
      resolve(content);
    });
  });
}

function prepareForceIncludeForSerialization(forceInclude = []) {
  // need to annotate forceInclude values to allow RegExp to pass through JSON serialization
  return forceInclude.map(function (forceIncludeValue) {
    if (typeof forceIncludeValue === 'object' && forceIncludeValue.constructor.name === 'RegExp') {
      return {
        type: 'RegExp',
        source: forceIncludeValue.source,
        flags: forceIncludeValue.flags
      };
    }
    return { value: forceIncludeValue };
  });
}

// const so not hoisted, so can get regeneratorRuntime inlined above, needed for Node 4
const generateCriticalCssWrapped = (() => {
  var _ref3 = _asyncToGenerator(function* (options, { forceTryRestartBrowser } = {}) {
    const width = parseInt(options.width || DEFAULT_VIEWPORT_WIDTH, 10);
    const height = parseInt(options.height || DEFAULT_VIEWPORT_HEIGHT, 10);
    const timeoutWait = options.timeout || DEFAULT_TIMEOUT;
    // Merge properties with default ones
    const propertiesToRemove = options.propertiesToRemove || DEFAULT_PROPERTIES_TO_REMOVE;

    // always forceInclude '*', 'html', and 'body' selectors
    const forceInclude = prepareForceIncludeForSerialization([{ value: '*' }, { value: 'html' }, { value: 'body' }].concat(options.forceInclude || []));

    // promise so we can handle errors and reject,
    // instead of throwing what would otherwise be uncaught errors in node process
    return new Promise((() => {
      var _ref4 = _asyncToGenerator(function* (resolve, reject) {
        const cleanupAndExit = function cleanupAndExit({ returnValue, error }) {
          process.removeListener('exit', exitHandler);
          process.removeListener('SIGTERM', exitHandler);
          process.removeListener('SIGINT', exitHandler);

          if (error) {
            reject(error);
          } else {
            resolve(returnValue);
          }
        };

        debuglog('call generateCriticalCssWrapped');
        let formattedCss;
        try {
          _browserPagesOpen++;
          debuglog('adding browser page for generateCriticalCss, now: ' + _browserPagesOpen);
          formattedCss = yield (0, _core2.default)({
            browser,
            url: options.url,
            cssString: options.cssString,
            width,
            height,
            forceInclude,
            strict: options.strict,
            userAgent: options.userAgent || DEFAULT_USER_AGENT,
            renderWaitTime: options.renderWaitTime || DEFAULT_RENDER_WAIT_TIMEOUT,
            timeout: timeoutWait,
            pageLoadSkipTimeout: options.pageLoadSkipTimeout,
            blockJSRequests: typeof options.blockJSRequests !== 'undefined' ? options.blockJSRequests : DEFAULT_BLOCK_JS_REQUESTS,
            customPageHeaders: options.customPageHeaders,
            screenshots: options.screenshots,
            keepLargerMediaQueries: options.keepLargerMediaQueries,
            // postformatting
            propertiesToRemove,
            maxEmbeddedBase64Length: typeof options.maxEmbeddedBase64Length === 'number' ? options.maxEmbeddedBase64Length : DEFAULT_MAX_EMBEDDED_BASE64_LENGTH,
            debuglog,
            unstableKeepBrowserAlive: options.unstableKeepBrowserAlive
          });
          _browserPagesOpen--;
          debuglog('remove browser page for generateCriticalCss, now: ' + _browserPagesOpen);
        } catch (e) {
          _browserPagesOpen--;
          debuglog('remove browser page for generateCriticalCss after ERROR, now: ' + _browserPagesOpen);
          if (!forceTryRestartBrowser && !(yield browserIsRunning())) {
            debuglog('Chromium unexpecedly not opened - crashed? ' + '\n_browserPagesOpen: ' + (_browserPagesOpen + 1) + '\nurl: ' + options.url + '\ncss length: ' + options.cssString.length);
            // for some reason Chromium is no longer opened;
            // perhaps it crashed
            if (_browserLaunchPromise) {
              // in this case the browser is already restarting
              yield _browserLaunchPromise;
            } else if (!(options.puppeteer && options.puppeteer.getBrowser)) {
              console.log('restarting chrome after crash');
              browser = null;
              yield launchBrowserIfNeeded({});
            }
            // retry
            resolve(generateCriticalCssWrapped(options, {
              forceTryRestartBrowser: true
            }));
            return;
          }
          cleanupAndExit({ error: e });
          return;
        }
        debuglog('generateCriticalCss done');
        if (formattedCss.trim().length === 0) {
          // TODO: would be good to surface this to user, always
          debuglog('Note: Generated critical css was empty for URL: ' + options.url);
          cleanupAndExit({ returnValue: '' });
          return;
        }

        cleanupAndExit({ returnValue: formattedCss });
      });

      return function (_x3, _x4) {
        return _ref4.apply(this, arguments);
      };
    })());
  });

  function generateCriticalCssWrapped(_x2) {
    return _ref3.apply(this, arguments);
  }

  return generateCriticalCssWrapped;
})();

module.exports = function (options, callback) {
  process.on('exit', exitHandler);
  process.on('SIGTERM', exitHandler);
  process.on('SIGINT', exitHandler);

  return new Promise((() => {
    var _ref5 = _asyncToGenerator(function* (resolve, reject) {
      const cleanupAndExit = function cleanupAndExit({ returnValue, error = null }) {
        if (browser && !options.unstableKeepBrowserAlive) {
          if (_browserPagesOpen > 0) {
            debuglog('keeping browser open as _browserPagesOpen: ' + _browserPagesOpen);
          } else {
            browser.close();
            browser = null;
            _browserLaunchPromise = null;
            debuglog('closed browser');
          }
        }

        // still supporting legacy callback way of calling Penthouse
        if (callback) {
          callback(error, returnValue);
          return;
        }
        if (error) {
          reject(error);
        } else {
          resolve(returnValue);
        }
      };

      // support legacy mode of passing in css file path instead of string
      if (!options.cssString && options.css) {
        try {
          const cssString = yield readFilePromise(options.css, 'utf8');
          options = Object.assign({}, options, { cssString });
        } catch (err) {
          debuglog('error reading css file: ' + options.css + ', error: ' + err);
          cleanupAndExit({ error: err });
          return;
        }
      }
      if (!options.cssString) {
        debuglog('Passed in css is empty');
        cleanupAndExit({ error: new Error('css should not be empty') });
        return;
      }

      yield launchBrowserIfNeeded({
        getBrowser: options.puppeteer && options.puppeteer.getBrowser
      });
      try {
        const criticalCss = yield generateCriticalCssWrapped(options);
        cleanupAndExit({ returnValue: criticalCss });
      } catch (err) {
        cleanupAndExit({ error: err });
      }
    });

    return function (_x5, _x6) {
      return _ref5.apply(this, arguments);
    };
  })());
};